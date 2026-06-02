#pragma once
#include <cstdint>
#include <cstddef>

namespace edge {

struct ModbusFrame {
    uint8_t  slave;       // direccion del esclavo
    uint8_t  function;    // codigo de funcion
    uint8_t  len;         // bytes totales de la trama capturada
    bool     crcValido;   // CRC verificado
    uint32_t lastSeenMs;  // millis() de captura
};

// Inicia la tarea FreeRTOS del sniffer Modbus RTU pasivo (listen-only).
// SEGURIDAD: nunca transmite al bus. DE debe quedar HIGH desde setup().
// Debe llamarse despues de initEventBus().
bool initModbus();

// Copia thread-safe de las ultimas tramas capturadas (mas reciente primero).
// Si no consigue el mutex en 10ms, retorna 0 sin bloquear.
size_t obtenerTramasModbus(ModbusFrame* out, size_t maxOut);

}  // namespace edge
