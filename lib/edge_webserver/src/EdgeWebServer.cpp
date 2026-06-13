#include "EdgeWebServer.h"
#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include <SD.h>
#include <ArduinoJson.h>
#include "config.h"
#include "EdgeNetwork.h"
#include "EdgeBle.h"
#include "EdgeModbus.h"
#include "EdgeCan.h"
#include "EdgeAlerts.h"
#include "EdgeLogger.h"
#include "EdgeStorage.h"
#include "EdgeHousekeeping.h"
#include "events.h"

namespace edge {

static AsyncWebServer s_server(HTTP_PORT);

// Buffer de salida JSON compartido por todos los handlers. Los callbacks de
// ESPAsyncWebServer corren serializados en el task async_tcp (uno a la vez),
// asi que un unico buffer estatico es seguro y ahorra DRAM frente a tener uno
// por endpoint. Dimensionado al peor caso (/api/events con 64 eventos).
static char s_out[9216];

// Buffer de acumulacion del body del POST /api/map/layout. El layout del mapa
// de planta es config (no escribe al bus Modbus/CAN: persiste a LittleFS), por
// eso si esta permitido escribir aca. Dimensionado a ~100 entidades (equipos +
// estructuras); la DRAM estatica del ESP32 es escasa. Si el body excede la
// capacidad, s_mapOverflow corta y el handler responde 400 (fail fast).
static char   s_mapBody[8192];
static size_t s_mapLen      = 0;
static bool   s_mapOverflow = false;

// Layout vacio por defecto cuando el dispositivo aun no tiene /map.json guardado.
static const char* MAP_VACIO = "{\"v\":1,\"nodes\":[],\"cables\":[]}";

bool initWebServer() {
    if (!LittleFS.begin(false)) {
        Serial.println("[web] LittleFS: fallo al montar");
        return false;
    }

    // Three.js runtime (vendor/) se sirve desde LittleFS para que el mapa 3D
    // funcione aunque la microSD no este presente. Los modelos GLB (/models/)
    // viven en SD por su peso; si la SD no esta, el mapa cae a primitivas
    // procedurales (degradacion elegante). Se registran ANTES que "/" porque
    // serveStatic("/") matchea cualquier ruta.
    s_server.serveStatic("/vendor", LittleFS, "/vendor").setCacheControl("max-age=86400");
    s_server.serveStatic("/models", SD, "/models").setCacheControl("max-age=86400");

    s_server.serveStatic("/", LittleFS, "/")
            .setDefaultFile("index.html")
            .setCacheControl("max-age=600");

    s_server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest* request) {
        JsonDocument doc;
        doc["device"]    = DEVICE_NAME;
        doc["version"]   = FIRMWARE_VERSION;
        doc["build"]     = FIRMWARE_BUILD;
        doc["uptime_s"]  = millis() / 1000;
        doc["free_heap"] = ESP.getFreeHeap();

        char ipBuf[16];
        IPAddress ip = getLocalIP();
        snprintf(ipBuf, sizeof(ipBuf), "%u.%u.%u.%u", ip[0], ip[1], ip[2], ip[3]);
        doc["ip"] = ipBuf;

        char buf[320];
        serializeJson(doc, buf, sizeof(buf));
        request->send(200, "application/json", buf);
    });

    s_server.on("/api/stats", HTTP_GET, [](AsyncWebServerRequest* request) {
        static BleDevice   bleBuf[50];
        static ModbusFrame mbBuf[20];
        static CanFrame    canBuf[20];
        static AuditEvent  evBuf[64];
        static AlertEntry  alBuf[32];
        size_t nBle = edge::obtenerDispositivos(bleBuf, 50);
        size_t nMb  = edge::obtenerTramasModbus(mbBuf, 20);
        size_t nCan = edge::obtenerTramasCan(canBuf, 20);
        size_t nEv  = edge::obtenerEventosRecientes(evBuf, 64);
        size_t nAl  = edge::obtenerAlertas(alBuf, 32);
        size_t mbValid = 0;
        for (size_t i = 0; i < nMb; i++) if (mbBuf[i].crcValido) mbValid++;

        JsonDocument doc;
        doc["ble"]          = nBle;
        doc["modbus"]       = nMb;
        doc["modbus_valid"] = mbValid;
        doc["can"]          = nCan;
        doc["alertas"]      = nAl;
        doc["eventos"]      = nEv;
        doc["ntp"]          = edge::horaSincronizada();
        doc["sd"]           = edge::sdDisponible();
        doc["heap"]         = edge::heapLibre();
        doc["heap_min"]     = edge::heapMinimo();
        doc["uptime_s"]     = millis() / 1000;
        serializeJson(doc, s_out, sizeof(s_out));
        request->send(200, "application/json", s_out);
    });

    s_server.on("/api/ble/devices", HTTP_GET, [](AsyncWebServerRequest* request) {
        static BleDevice buf[50];
        size_t n = edge::obtenerDispositivos(buf, 50);

        JsonDocument doc;
        JsonArray arr = doc.to<JsonArray>();
        for (size_t i = 0; i < n; i++) {
            JsonObject d = arr.add<JsonObject>();
            d["mac"]     = buf[i].mac;
            d["nombre"]  = buf[i].name;
            d["rssi"]    = buf[i].rssi;
            d["visto_ms"] = millis() - buf[i].lastSeenMs;
        }

        serializeJson(doc, s_out, sizeof(s_out));
        request->send(200, "application/json", s_out);
    });

    s_server.on("/api/modbus", HTTP_GET, [](AsyncWebServerRequest* request) {
        static ModbusFrame buf[20];
        size_t n = edge::obtenerTramasModbus(buf, 20);

        JsonDocument doc;
        JsonArray arr = doc.to<JsonArray>();
        for (size_t i = 0; i < n; i++) {
            JsonObject f = arr.add<JsonObject>();
            f["slave"]    = buf[i].slave;
            f["function"] = buf[i].function;
            f["len"]      = buf[i].len;
            f["crc_ok"]   = buf[i].crcValido;
            f["visto_ms"] = millis() - buf[i].lastSeenMs;
        }
        serializeJson(doc, s_out, sizeof(s_out));
        request->send(200, "application/json", s_out);
    });

    s_server.on("/api/can", HTTP_GET, [](AsyncWebServerRequest* request) {
        static CanFrame buf[20];
        size_t n = edge::obtenerTramasCan(buf, 20);

        JsonDocument doc;
        JsonArray arr = doc.to<JsonArray>();
        for (size_t i = 0; i < n; i++) {
            JsonObject f = arr.add<JsonObject>();
            char idHex[12];
            snprintf(idHex, sizeof(idHex), "0x%X", (unsigned)buf[i].id);
            f["id"]       = idHex;
            f["ext"]      = buf[i].extendido;
            f["dlc"]      = buf[i].dlc;
            char datos[24];
            size_t pos = 0;
            for (uint8_t b = 0; b < buf[i].dlc; b++) {
                pos += snprintf(datos + pos, sizeof(datos) - pos, "%02X ", buf[i].data[b]);
            }
            f["datos"]    = datos;
            f["visto_ms"] = millis() - buf[i].lastSeenMs;
        }
        serializeJson(doc, s_out, sizeof(s_out));
        request->send(200, "application/json", s_out);
    });

    s_server.on("/api/alerts", HTTP_GET, [](AsyncWebServerRequest* request) {
        static AlertEntry buf[32];
        size_t n = edge::obtenerAlertas(buf, 32);

        JsonDocument doc;
        JsonArray arr = doc.to<JsonArray>();
        for (size_t i = 0; i < n; i++) {
            JsonObject a = arr.add<JsonObject>();
            a["utc"]     = (uint32_t)buf[i].utc;
            a["nivel"]   = buf[i].nivel;
            a["mensaje"] = buf[i].mensaje;
        }
        serializeJson(doc, s_out, sizeof(s_out));
        request->send(200, "application/json", s_out);
    });

    s_server.on("/api/events", HTTP_GET, [](AsyncWebServerRequest* req) {
        static AuditEvent buf[64];
        size_t n = edge::obtenerEventosRecientes(buf, 64);

        JsonDocument doc;
        JsonArray arr = doc.to<JsonArray>();
        for (size_t i = 0; i < n; i++) {
            JsonObject e = arr.add<JsonObject>();
            e["utc"]       = (uint32_t)buf[i].utc;
            e["uptime_ms"] = buf[i].uptimeMs;
            e["source"]    = buf[i].source;
            e["detail"]    = buf[i].detail;
        }
        serializeJson(doc, s_out, sizeof(s_out));
        req->send(200, "application/json", s_out);
    });

    s_server.on("/api/logs", HTTP_GET, [](AsyncWebServerRequest* req) {
        JsonDocument doc;
        if (!edge::sdDisponible()) {
            doc["sd"] = false;
            JsonArray arr = doc["archivos"].to<JsonArray>();
            (void)arr;
            serializeJson(doc, s_out, sizeof(s_out));
            req->send(200, "application/json", s_out);
            return;
        }

        doc["sd"] = true;
        JsonArray arr = doc["archivos"].to<JsonArray>();
        // Buffer estatico: listarArchivosAudit recibe funcion sin captura
        static struct { char nombre[32]; size_t bytes; } s_files[32];
        static size_t s_fileCount = 0;
        s_fileCount = 0;
        edge::listarArchivosAudit([](const char* nombre, size_t bytes) {
            if (s_fileCount < 32) {
                strncpy(s_files[s_fileCount].nombre, nombre, 31);
                s_files[s_fileCount].nombre[31] = '\0';
                s_files[s_fileCount].bytes = bytes;
                s_fileCount++;
            }
        });
        for (size_t i = 0; i < s_fileCount; i++) {
            JsonObject f = arr.add<JsonObject>();
            f["nombre"] = s_files[i].nombre;
            f["bytes"]  = (uint32_t)s_files[i].bytes;
        }
        serializeJson(doc, s_out, sizeof(s_out));
        req->send(200, "application/json", s_out);
    });

    s_server.on("/api/logs/download", HTTP_GET, [](AsyncWebServerRequest* req) {
        if (!req->hasParam("file")) {
            req->send(400, "text/plain", "Parametro file requerido");
            return;
        }
        String nombre = req->getParam("file")->value();
        // Validacion estricta: solo nombre plano .csv, sin path separators ni ..
        if (nombre.length() == 0 || nombre.length() > 30
            || !nombre.endsWith(".csv")
            || nombre.indexOf('/') >= 0
            || nombre.indexOf('\\') >= 0
            || nombre.indexOf("..") >= 0) {
            req->send(400, "text/plain", "Nombre de archivo invalido");
            return;
        }
        if (!edge::sdDisponible()) {
            req->send(404, "text/plain", "microSD no disponible");
            return;
        }
        if (!edge::auditExists(nombre.c_str())) {
            req->send(404, "text/plain", "Archivo no encontrado");
            return;
        }
        String path = String("/audit/") + nombre;
        req->send(SD, path.c_str(), "text/csv", true);
    });

    // Layout del mapa de planta: posiciones autoradas de equipos y cableado.
    // El Edge no detecta posicion fisica; el usuario dibuja la planta y el
    // dashboard enlaza las detecciones reales por MAC/esclavo/CAN ID.
    s_server.on("/api/map/layout", HTTP_GET, [](AsyncWebServerRequest* req) {
        if (LittleFS.exists("/map.json")) {
            req->send(LittleFS, "/map.json", "application/json");
        } else {
            req->send(200, "application/json", MAP_VACIO);
        }
    });

    s_server.on("/api/map/layout", HTTP_POST,
        [](AsyncWebServerRequest* req) {
            if (s_mapOverflow || s_mapLen == 0) {
                s_mapLen = 0; s_mapOverflow = false;
                req->send(400, "application/json", "{\"ok\":false,\"error\":\"body invalido\"}");
                return;
            }
            JsonDocument doc;
            DeserializationError err = deserializeJson(doc, s_mapBody, s_mapLen);
            if (err) {
                s_mapLen = 0;
                req->send(400, "application/json", "{\"ok\":false,\"error\":\"json invalido\"}");
                return;
            }
            File f = LittleFS.open("/map.json", "w");
            if (!f) {
                s_mapLen = 0;
                req->send(500, "application/json", "{\"ok\":false,\"error\":\"fs\"}");
                return;
            }
            f.write((const uint8_t*)s_mapBody, s_mapLen);
            f.close();
            s_mapLen = 0;
            req->send(200, "application/json", "{\"ok\":true}");
        },
        NULL,
        [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
            if (index == 0) { s_mapLen = 0; s_mapOverflow = false; }
            if (s_mapLen + len > sizeof(s_mapBody)) { s_mapOverflow = true; return; }
            memcpy(s_mapBody + s_mapLen, data, len);
            s_mapLen += len;
        });

    s_server.onNotFound([](AsyncWebServerRequest* request) {
        request->send(404, "text/plain", "No encontrado");
    });

    s_server.begin();
    Serial.printf("[web] HTTP escuchando en puerto %u\n", HTTP_PORT);
    return true;
}

}  // namespace edge
