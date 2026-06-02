#include "EdgeNetwork.h"
#include <ETH.h>
#include <ESPmDNS.h>
#include <WiFi.h>
#include <esp_sntp.h>
#include "config.h"
#include "pins.h"

namespace edge {

static volatile bool s_ethConnected = false;
static IPAddress s_localIp;

static void onEthEvent(arduino_event_id_t event, arduino_event_info_t info) {
    switch (event) {
        case ARDUINO_EVENT_ETH_START:
            ETH.setHostname(MDNS_HOSTNAME);
            Serial.println("[net] Ethernet iniciado");
            break;
        case ARDUINO_EVENT_ETH_CONNECTED:
            Serial.println("[net] link up");
            break;
        case ARDUINO_EVENT_ETH_GOT_IP:
            s_localIp = ETH.localIP();
            s_ethConnected = true;
            Serial.printf("[net] IP: %s\n", s_localIp.toString().c_str());
            break;
        case ARDUINO_EVENT_ETH_DISCONNECTED:
            s_ethConnected = false;
            Serial.println("[net] link down");
            break;
        case ARDUINO_EVENT_ETH_STOP:
            s_ethConnected = false;
            Serial.println("[net] Ethernet detenido");
            break;
        default:
            break;
    }
}

bool initNetwork() {
    WiFi.onEvent(onEthEvent);

    if (!ETH.begin(PIN_ETH_PHY_ADDR,
                   PIN_ETH_POWER,
                   PIN_ETH_MDC,
                   PIN_ETH_MDIO,
                   ETH_PHY_IP101,
                   ETH_CLOCK_GPIO0_IN)) {
        Serial.println("[net] ETH.begin() fallo");
        return false;
    }

    uint32_t startMs = millis();
    while (!s_ethConnected && (millis() - startMs) < 10000) {
        delay(100);
    }

    if (!s_ethConnected) {
        Serial.println("[net] timeout: sin IP en 10s");
        return false;
    }

    if (!MDNS.begin(MDNS_HOSTNAME)) {
        Serial.println("[net] mDNS: fallo al registrar hostname");
        return false;
    }
    MDNS.addService("http", "tcp", HTTP_PORT);
    Serial.printf("[net] mDNS registrado: %s.local\n", MDNS_HOSTNAME);

    configTime(0, 0, NTP_SERVER_1, NTP_SERVER_2);
    Serial.println("[net] NTP iniciado (sincronizacion en segundo plano)");

    return true;
}

IPAddress getLocalIP() {
    return s_localIp;
}

bool isOnline() {
    return s_ethConnected;
}

bool horaSincronizada() {
    return time(nullptr) > 1700000000;  // epoch posterior a nov-2023
}

time_t ahoraUTC() {
    time_t t = time(nullptr);
    return (t > 1700000000) ? t : 0;
}

}  // namespace edge
