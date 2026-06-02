#include <Arduino.h>
#include "config.h"
#include "pins.h"
#include "EdgeNetwork.h"
#include "EdgeStorage.h"
#include "EdgeEventBus.h"
#include "EdgeLogger.h"
#include "EdgeWebServer.h"
#include "EdgeBle.h"
#include "EdgeModbus.h"

void setup() {
    // SEGURIDAD HARDWARE: RS485 DE en modo recepcion antes que nada.
    // EL357N invierte la logica: HIGH al GPIO = receive mode.
    pinMode(PIN_RS485_DE, OUTPUT);
    digitalWrite(PIN_RS485_DE, HIGH);

    // LED user como indicador visible de boot.
    pinMode(PIN_LED_USER, OUTPUT);
    digitalWrite(PIN_LED_USER, LOW);

    Serial.begin(SERIAL_BAUD);
    delay(200);
    Serial.println();
    Serial.printf("[boot] %s v%s\n", DEVICE_NAME, FIRMWARE_VERSION);
    Serial.printf("[boot] Build: %s\n", FIRMWARE_BUILD);

    if (!edge::initNetwork()) {
        Serial.println("[boot] FALLO: red no operativa");
        return;
    }

    // SD: fallo no es fatal -- sistema sigue sin persistencia
    edge::initStorage();

    if (!edge::initEventBus()) {
        Serial.println("[boot] FALLO: event bus no operativo");
        return;
    }

    if (!edge::initLogger()) {
        Serial.println("[boot] FALLO: logger no operativo");
        return;
    }

    if (!edge::initWebServer()) {
        Serial.println("[boot] FALLO: web server no operativo");
        return;
    }

    if (!edge::initBle()) {
        Serial.println("[boot] FALLO: BLE no operativo");
        return;
    }

    if (!edge::initModbus()) {
        Serial.println("[boot] FALLO: Modbus sniffer no operativo");
        return;
    }

    digitalWrite(PIN_LED_USER, HIGH);  // boot completo
    Serial.println("[boot] Sistema operativo");
}

void loop() {
    // Heartbeat cada HEARTBEAT_INTERVAL_MS.
    // Las tareas reales viviran en FreeRTOS tasks dentro de cada libreria.
    static uint32_t lastHeartbeat = 0;
    uint32_t now = millis();
    if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
        lastHeartbeat = now;
        Serial.printf("[hb] uptime=%us heap=%u ip=%s\n",
                      now / 1000,
                      ESP.getFreeHeap(),
                      edge::getLocalIP().toString().c_str());
    }
    delay(100);
}
