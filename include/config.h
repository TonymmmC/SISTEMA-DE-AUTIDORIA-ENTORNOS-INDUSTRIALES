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

// NTP
constexpr const char* NTP_SERVER_1 = "pool.ntp.org";
constexpr const char* NTP_SERVER_2 = "time.nist.gov";

// Watchdog timeout (s)
constexpr uint32_t WATCHDOG_TIMEOUT_S = 30;

// Modbus RTU sniffer (pasivo, listen-only sobre Serial2/RS485)
constexpr uint32_t MODBUS_BAUD   = 9600;  // baudrate comun en Modbus RTU industrial
constexpr uint32_t MODBUS_GAP_MS = 4;     // gap inter-trama: 3.5 chars @9600 8N1 ~3.6ms

// CAN Bus listener (TWAI listen-only). Bitrate comun industrial: 500 kbit/s.
// El driver TWAI no transmite ACK ni error frames en modo listen-only.
constexpr uint32_t CAN_BITRATE_KBPS = 500;
