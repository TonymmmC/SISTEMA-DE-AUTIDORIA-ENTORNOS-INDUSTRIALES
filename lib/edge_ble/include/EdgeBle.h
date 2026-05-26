#pragma once
#include <cstdint>
#include <cstddef>

namespace edge {

struct BleDevice {
    char     mac[18];       // "AA:BB:CC:DD:EE:FF"
    char     name[32];      // nombre o "" si no disponible
    int8_t   rssi;          // dBm
    uint32_t lastSeenMs;    // millis() de la ultima vez visto
};

// Inicia la tarea FreeRTOS de escaneo BLE pasivo.
// Debe llamarse despues de initNetwork() y despues de initWebServer().
// Retorna true si la tarea arranco correctamente.
bool initBle();

// Copia thread-safe del snapshot actual de dispositivos detectados.
// Escribe en `out` hasta `maxOut` entradas. Retorna cantidad escrita.
// Si no puede tomar el mutex en 10ms, retorna 0 sin bloquear.
size_t obtenerDispositivos(BleDevice* out, size_t maxOut);

}  // namespace edge
