#pragma once
#include <cstdint>
#include <cstddef>

// Funciones puras de Modbus RTU (CRC-16 y parsing de trama).
// Header-only y sin dependencia de Arduino: testeable con `pio test` en native.

namespace edge {

// Trama Modbus RTU minima: direccion + funcion + CRC(2). Cualquier cosa mas
// corta no es una trama valida.
constexpr size_t MODBUS_MIN_FRAME = 4;

struct ParsedFrame {
    uint8_t  slave;      // direccion del esclavo (byte 0)
    uint8_t  function;   // codigo de funcion (byte 1)
    uint16_t crcRecv;    // CRC presente en la trama (ultimos 2 bytes, LE)
    uint16_t crcCalc;    // CRC calculado sobre la trama menos los 2 ultimos bytes
    bool     crcValido;  // crcRecv == crcCalc
    bool     valida;     // longitud suficiente y CRC correcto
};

// CRC-16 Modbus (poly reflejado 0xA001, init 0xFFFF). Tabla de 256 entradas
// construida una sola vez (no calculo bit a bit por trama). El ESP32 mapea
// el const a flash; aqui se construye lazy para ser portable al test native.
inline uint16_t crc16Modbus(const uint8_t* buf, size_t len) {
    static uint16_t tabla[256];
    static bool lista = false;
    if (!lista) {
        for (int i = 0; i < 256; i++) {
            uint16_t crc = (uint16_t)i;
            for (int j = 0; j < 8; j++) {
                crc = (crc & 1) ? ((crc >> 1) ^ 0xA001) : (crc >> 1);
            }
            tabla[i] = crc;
        }
        lista = true;
    }
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= (uint16_t)buf[i];
        crc = (crc >> 8) ^ tabla[crc & 0xFF];
    }
    return crc;
}

// Parsea un buffer crudo recibido del bus. No confia en el input (Zero Trust):
// valida longitud y CRC antes de marcar la trama como valida.
inline ParsedFrame parsearTramaModbus(const uint8_t* buf, size_t len) {
    ParsedFrame f = {};
    if (buf == nullptr || len < MODBUS_MIN_FRAME) {
        return f;
    }
    f.slave    = buf[0];
    f.function = buf[1];
    f.crcRecv  = (uint16_t)buf[len - 2] | ((uint16_t)buf[len - 1] << 8);
    f.crcCalc  = crc16Modbus(buf, len - 2);
    f.crcValido = (f.crcRecv == f.crcCalc);
    f.valida    = f.crcValido;
    return f;
}

}  // namespace edge
