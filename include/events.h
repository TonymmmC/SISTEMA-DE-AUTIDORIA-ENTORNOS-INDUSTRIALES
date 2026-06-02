#pragma once
#include <cstdint>
#include <ctime>

namespace edge {

enum class EventType : uint8_t {
    BLE_DEVICE_FOUND = 1,
    MODBUS_FRAME     = 2,
    // CAN_FRAME (Fase 6)
};

struct AuditEvent {
    EventType type;
    uint32_t  uptimeMs;   // millis() en que ocurrio
    time_t    utc;        // epoch UTC; 0 si hora no sincronizada
    char      source[12]; // "ble", "modbus", "can"
    char      detail[64]; // "MAC=AA:.. name=.. rssi=-42"
};

}  // namespace edge
