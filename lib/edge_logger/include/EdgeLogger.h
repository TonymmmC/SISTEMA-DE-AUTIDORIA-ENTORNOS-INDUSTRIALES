#pragma once
#include "events.h"
#include <cstddef>

namespace edge {

// Lanza LoggerTask (prioridad 3, core 0). Debe llamarse despues de initEventBus().
bool initLogger();

// Snapshot thread-safe del ring buffer para el feed del dashboard.
// Escribe hasta maxOut eventos (mas recientes primero). Retorna cantidad.
// Si no consigue mutex en 10ms, retorna 0 sin bloquear.
size_t obtenerEventosRecientes(AuditEvent* out, size_t maxOut);

}  // namespace edge
