#include "EdgeBle.h"
#include <Arduino.h>
#include <NimBLEDevice.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

namespace edge {

static const size_t   MAX_DEVICES       = 50;
static const uint32_t SCAN_DURATION_S   = 5;
static const uint32_t DEVICE_TIMEOUT_MS = 120000;  // 2 min sin ver = expirado
static const uint32_t MUTEX_TIMEOUT_MS  = 10;

static BleDevice        s_devices[MAX_DEVICES];
static size_t           s_count = 0;
static SemaphoreHandle_t s_mutex = nullptr;

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

static void actualizarOAgregar(const char* mac, const char* nombre, int8_t rssi) {
    uint32_t ahora = millis();
    for (size_t i = 0; i < s_count; i++) {
        if (strncmp(s_devices[i].mac, mac, sizeof(s_devices[i].mac)) == 0) {
            s_devices[i].rssi       = rssi;
            s_devices[i].lastSeenMs = ahora;
            strncpy(s_devices[i].name, nombre, sizeof(s_devices[i].name) - 1);
            s_devices[i].name[sizeof(s_devices[i].name) - 1] = '\0';
            return;
        }
    }
    if (s_count < MAX_DEVICES) {
        strncpy(s_devices[s_count].mac,  mac,    sizeof(s_devices[s_count].mac) - 1);
        s_devices[s_count].mac[sizeof(s_devices[s_count].mac) - 1] = '\0';
        strncpy(s_devices[s_count].name, nombre, sizeof(s_devices[s_count].name) - 1);
        s_devices[s_count].name[sizeof(s_devices[s_count].name) - 1] = '\0';
        s_devices[s_count].rssi       = rssi;
        s_devices[s_count].lastSeenMs = ahora;
        s_count++;
    }
}

static void expirarDispositivos() {
    uint32_t ahora = millis();
    size_t i = 0;
    while (i < s_count) {
        if (ahora - s_devices[i].lastSeenMs > DEVICE_TIMEOUT_MS) {
            // Reemplaza el expirado con el ultimo para compactar sin mover todo
            s_devices[i] = s_devices[s_count - 1];
            s_count--;
        } else {
            i++;
        }
    }
}

// ---------------------------------------------------------------------------
// Callback NimBLE: se llama desde el contexto del scan por cada advertising
// ---------------------------------------------------------------------------

class BleCallbacks : public NimBLEAdvertisedDeviceCallbacks {
    void onResult(NimBLEAdvertisedDevice* dev) override {
        if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(MUTEX_TIMEOUT_MS)) != pdTRUE) {
            return;
        }
        char mac[18];
        snprintf(mac, sizeof(mac), "%s", dev->getAddress().toString().c_str());

        const char* nombre = "";
        if (dev->haveName()) {
            nombre = dev->getName().c_str();
        }

        actualizarOAgregar(mac, nombre, (int8_t)dev->getRSSI());
        xSemaphoreGive(s_mutex);
    }
};

static BleCallbacks s_callbacks;

// ---------------------------------------------------------------------------
// Tarea FreeRTOS
// ---------------------------------------------------------------------------

static void bleScanTask(void* /*arg*/) {
    NimBLEScan* scan = NimBLEDevice::getScan();
    scan->setAdvertisedDeviceCallbacks(&s_callbacks, false);
    scan->setActiveScan(false);   // pasivo: no envia scan requests
    scan->setInterval(97);        // ms, primos para evitar sincronizacion con beacons
    scan->setWindow(37);

    while (true) {
        if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(MUTEX_TIMEOUT_MS)) == pdTRUE) {
            expirarDispositivos();
            xSemaphoreGive(s_mutex);
        }

        scan->start(SCAN_DURATION_S, false);  // bloqueante hasta fin del ciclo
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

// ---------------------------------------------------------------------------
// API publica
// ---------------------------------------------------------------------------

bool initBle() {
    s_mutex = xSemaphoreCreateMutex();
    if (s_mutex == nullptr) {
        Serial.println("[ble] FALLO: no pudo crear mutex");
        return false;
    }

    NimBLEDevice::init("");

    BaseType_t ok = xTaskCreatePinnedToCore(
        bleScanTask,
        "BleScanTask",
        4096,
        nullptr,
        4,          // prioridad 4
        nullptr,
        0           // core 0; el web server usa core 1
    );

    if (ok != pdPASS) {
        Serial.println("[ble] FALLO: no pudo crear tarea BLE");
        return false;
    }

    Serial.println("[ble] Scanner BLE iniciado (pasivo)");
    return true;
}

size_t obtenerDispositivos(BleDevice* out, size_t maxOut) {
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(MUTEX_TIMEOUT_MS)) != pdTRUE) {
        return 0;
    }
    size_t n = (s_count < maxOut) ? s_count : maxOut;
    for (size_t i = 0; i < n; i++) {
        out[i] = s_devices[i];
    }
    xSemaphoreGive(s_mutex);
    return n;
}

}  // namespace edge
