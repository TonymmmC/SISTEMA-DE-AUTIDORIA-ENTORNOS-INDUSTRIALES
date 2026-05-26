#include "EdgeWebServer.h"
#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include "config.h"
#include "EdgeNetwork.h"
#include "EdgeBle.h"

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

        // 50 devices * ~80 bytes = ~4KB + overhead JSON
        char out[5120];
        serializeJson(doc, out, sizeof(out));
        request->send(200, "application/json", out);
    });

    s_server.onNotFound([](AsyncWebServerRequest* request) {
        request->send(404, "text/plain", "No encontrado");
    });

    s_server.begin();
    Serial.printf("[web] HTTP escuchando en puerto %u\n", HTTP_PORT);
    return true;
}

}  // namespace edge
