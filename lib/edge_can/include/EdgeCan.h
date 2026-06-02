#pragma once
#include <cstdint>
#include <cstddef>

namespace edge {

struct CanFrame {
    uint32_t id;          // identificador (11 o 29 bits)
    bool     extendido;   // true si ID extendido de 29 bits
    uint8_t  dlc;         // data length code (0..8)
    uint8_t  data[8];     // payload
    uint32_t lastSeenMs;  // millis() de captura
};

// Inicia la tarea del listener CAN (TWAI listen-only, prioridad 5).
// SEGURIDAD: modo listen-only, el driver no transmite ACK ni error frames.
// Debe llamarse despues de initEventBus().
bool initCan();

// Copia thread-safe de las ultimas tramas capturadas (mas reciente primero).
// Si no consigue el mutex en 10ms, retorna 0 sin bloquear.
size_t obtenerTramasCan(CanFrame* out, size_t maxOut);

}  // namespace edge
