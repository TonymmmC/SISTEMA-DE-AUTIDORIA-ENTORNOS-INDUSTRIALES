#pragma once
#include "events.h"

namespace edge {

// Crea la cola FreeRTOS. Llamar en setup() antes de productores y logger.
bool initEventBus();

// No bloqueante. Si la cola esta llena descarta y retorna false.
// Seguro para llamar desde callbacks y tareas de captura de alta prioridad.
bool publicarEvento(const AuditEvent& ev);

// Bloquea hasta waitMs por un evento. Uso exclusivo del logger.
bool recibirEvento(AuditEvent& out, uint32_t waitMs);

}  // namespace edge
