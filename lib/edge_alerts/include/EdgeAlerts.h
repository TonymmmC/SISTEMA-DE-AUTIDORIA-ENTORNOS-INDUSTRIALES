#pragma once
#include <cstdint>
#include <cstddef>
#include <ctime>

namespace edge {

struct AlertEntry {
    uint32_t uptimeMs;
    time_t   utc;        // epoch UTC; 0 si hora no sincronizada
    char     nivel[10];  // "WARNING" / "CRITICAL"
    char     mensaje[80];
};

// Crea el mutex y el ring de alertas. Llamar en setup() antes de los modulos
// de captura.
bool initAlerts();

// Registra la aparicion de una entidad en un bus. La primera vez que se ve una
// pareja (source, key) genera una alerta de "entidad nueva". Idempotente para
// repeticiones. Seguro de llamar desde tareas de captura (no bloqueante salvo
// el mutex con timeout corto).
void notificarEntidad(const char* source, uint32_t key);

// Hash estable de una cadena (djb2). Util para mapear una MAC a una key.
uint32_t hashCadena(const char* s);

// Copia thread-safe de las alertas recientes (mas reciente primero).
size_t obtenerAlertas(AlertEntry* out, size_t maxOut);

}  // namespace edge
