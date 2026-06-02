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
#include "EdgeLogger.h"
#include "EdgeStorage.h"
#include "EdgeHousekeeping.h"
#include "events.h"

namespace edge {

static AsyncWebServer s_server(HTTP_PORT);

bool initWebServer() {
    if (!LittleFS.begin(false)) {
        Serial.println("[web] LittleFS: fallo al montar");
        return false;
    }

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
        size_t nBle = edge::obtenerDispositivos(bleBuf, 50);
        size_t nMb  = edge::obtenerTramasModbus(mbBuf, 20);
        size_t nCan = edge::obtenerTramasCan(canBuf, 20);
        size_t nEv  = edge::obtenerEventosRecientes(evBuf, 64);
        size_t mbValid = 0;
        for (size_t i = 0; i < nMb; i++) if (mbBuf[i].crcValido) mbValid++;

        JsonDocument doc;
        doc["ble"]          = nBle;
        doc["modbus"]       = nMb;
        doc["modbus_valid"] = mbValid;
        doc["can"]          = nCan;
        doc["eventos"]      = nEv;
        doc["ntp"]          = edge::horaSincronizada();
        doc["sd"]           = edge::sdDisponible();
        doc["heap"]         = edge::heapLibre();
        doc["heap_min"]     = edge::heapMinimo();
        doc["uptime_s"]     = millis() / 1000;
        static char out[384];
        serializeJson(doc, out, sizeof(out));
        request->send(200, "application/json", out);
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

        // 50 devices * ~80 bytes = ~4KB + overhead JSON.
        // Estatico: los handlers async corren serializados en async_tcp.
        static char out[5120];
        serializeJson(doc, out, sizeof(out));
        request->send(200, "application/json", out);
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
        static char out[2048];
        serializeJson(doc, out, sizeof(out));
        request->send(200, "application/json", out);
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
        static char out[3072];
        serializeJson(doc, out, sizeof(out));
        request->send(200, "application/json", out);
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
        // Peor caso 64 eventos con detail lleno ~8.8KB. Estatico para no
        // cargar el stack del task async y evitar truncado de serializeJson.
        static char out[9216];
        serializeJson(doc, out, sizeof(out));
        req->send(200, "application/json", out);
    });

    s_server.on("/api/logs", HTTP_GET, [](AsyncWebServerRequest* req) {
        JsonDocument doc;
        if (!edge::sdDisponible()) {
            doc["sd"] = false;
            JsonArray arr = doc["archivos"].to<JsonArray>();
            (void)arr;
            static char out[64];
            serializeJson(doc, out, sizeof(out));
            req->send(200, "application/json", out);
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
        static char out[2048];
        serializeJson(doc, out, sizeof(out));
        req->send(200, "application/json", out);
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

    s_server.onNotFound([](AsyncWebServerRequest* request) {
        request->send(404, "text/plain", "No encontrado");
    });

    s_server.begin();
    Serial.printf("[web] HTTP escuchando en puerto %u\n", HTTP_PORT);
    return true;
}

}  // namespace edge
