#pragma once
#include <cstdint>

namespace edge {

// Inicia la tarea de housekeeping (prioridad 1, core 0). Reporta heap cada
// HEAP_MONITOR_INTERVAL_MS por serial y mantiene el minimo historico para
// detectar tendencia descendente (posible leak en operacion 24/7).
bool initHousekeeping();

// Heap libre actual en bytes.
uint32_t heapLibre();

// Minimo historico de heap libre observado desde el boot.
uint32_t heapMinimo();

}  // namespace edge
