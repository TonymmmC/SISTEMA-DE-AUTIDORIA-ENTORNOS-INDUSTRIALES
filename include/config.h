#pragma once

// ============================================================================
// Configuracion global del sistema
// ============================================================================

// Version del firmware (semver)
constexpr const char* FIRMWARE_VERSION = "0.1.0";
constexpr const char* FIRMWARE_BUILD   = __DATE__ " " __TIME__;

// Identificacion del dispositivo
constexpr const char* DEVICE_NAME    = "Edge101 Auditor";
constexpr const char* MDNS_HOSTNAME  = "edge101";  // accesible como edge101.local

// HTTP server
constexpr uint16_t HTTP_PORT = 80;

// Serial monitor
constexpr uint32_t SERIAL_BAUD = 115200;

// Intervalos de housekeeping (ms)
constexpr uint32_t HEAP_MONITOR_INTERVAL_MS = 60000;
constexpr uint32_t HEARTBEAT_INTERVAL_MS    = 5000;

// Watchdog timeout (s)
constexpr uint32_t WATCHDOG_TIMEOUT_S = 30;
