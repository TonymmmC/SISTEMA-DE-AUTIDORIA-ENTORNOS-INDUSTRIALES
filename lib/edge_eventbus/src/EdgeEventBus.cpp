#include "EdgeEventBus.h"
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

namespace edge {

static const size_t EVENT_QUEUE_LEN = 32;
static QueueHandle_t s_queue = nullptr;

bool initEventBus() {
    s_queue = xQueueCreate(EVENT_QUEUE_LEN, sizeof(AuditEvent));
    if (s_queue == nullptr) {
        Serial.println("[bus] FALLO: no pudo crear cola de eventos");
        return false;
    }
    Serial.printf("[bus] Cola de eventos lista (%u slots)\n", EVENT_QUEUE_LEN);
    return true;
}

bool publicarEvento(const AuditEvent& ev) {
    if (s_queue == nullptr) return false;
    return xQueueSend(s_queue, &ev, 0) == pdTRUE;
}

bool recibirEvento(AuditEvent& out, uint32_t waitMs) {
    if (s_queue == nullptr) return false;
    return xQueueReceive(s_queue, &out, pdMS_TO_TICKS(waitMs)) == pdTRUE;
}

}  // namespace edge
