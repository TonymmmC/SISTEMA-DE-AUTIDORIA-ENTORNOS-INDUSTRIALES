#include <unity.h>
#include <cstdint>
#include <cstring>
#include "modbus_rtu.h"

using namespace edge;

// Vector de verificacion oficial del catalogo CRC-16/MODBUS:
// CRC sobre el ASCII "123456789" == 0x4B37.
void test_crc_vector_conocido(void) {
    const uint8_t datos[] = "123456789";
    TEST_ASSERT_EQUAL_HEX16(0x4B37, crc16Modbus(datos, 9));
}

// Trama bien formada: payload + CRC calculado en little-endian -> valida.
void test_trama_valida(void) {
    uint8_t buf[8] = { 0x01, 0x03, 0x00, 0x00, 0x00, 0x0A, 0, 0 };
    uint16_t crc = crc16Modbus(buf, 6);
    buf[6] = (uint8_t)(crc & 0xFF);
    buf[7] = (uint8_t)(crc >> 8);

    ParsedFrame f = parsearTramaModbus(buf, 8);
    TEST_ASSERT_TRUE(f.valida);
    TEST_ASSERT_TRUE(f.crcValido);
    TEST_ASSERT_EQUAL_UINT8(0x01, f.slave);
    TEST_ASSERT_EQUAL_UINT8(0x03, f.function);
}

// Un byte corrupto invalida el CRC.
void test_trama_crc_invalido(void) {
    uint8_t buf[8] = { 0x01, 0x03, 0x00, 0x00, 0x00, 0x0A, 0, 0 };
    uint16_t crc = crc16Modbus(buf, 6);
    buf[6] = (uint8_t)(crc & 0xFF);
    buf[7] = (uint8_t)(crc >> 8);
    buf[3] ^= 0xFF;  // corrompe un byte de datos

    ParsedFrame f = parsearTramaModbus(buf, 8);
    TEST_ASSERT_FALSE(f.valida);
    TEST_ASSERT_FALSE(f.crcValido);
}

// Una trama mas corta que el minimo Modbus no es valida.
void test_trama_demasiado_corta(void) {
    uint8_t buf[3] = { 0x01, 0x03, 0x00 };
    ParsedFrame f = parsearTramaModbus(buf, 3);
    TEST_ASSERT_FALSE(f.valida);
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_crc_vector_conocido);
    RUN_TEST(test_trama_valida);
    RUN_TEST(test_trama_crc_invalido);
    RUN_TEST(test_trama_demasiado_corta);
    return UNITY_END();
}
