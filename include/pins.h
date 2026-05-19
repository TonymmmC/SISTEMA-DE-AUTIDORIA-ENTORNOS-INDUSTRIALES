#pragma once

// ============================================================================
// Edge101 Pin Mapping (DFR0886)
// Verificado con esquematicos oficiales del fabricante.
// No modificar sin consultar HARDWARE_REFERENCE.md y los esquematicos.
// ============================================================================

// ---- Indicadores onboard ----
constexpr int PIN_LED_USER = 15;   // LED de usuario (output)
constexpr int PIN_BTN_KEY  = 38;   // Boton KEY (input-only)

// ---- Ethernet RMII (IP101GRI) ----
// Estos pines estan conectados internamente al PHY y NO deben usarse para
// otros propositos cuando Ethernet esta activo.
constexpr int PIN_ETH_PHY_ADDR  = 1;
constexpr int PIN_ETH_REF_CLK   = 0;   // GPIO0 -- REF_CLK input desde IP101GRI
constexpr int PIN_ETH_POWER     = 2;   // GPIO2 -- RESET del PHY
constexpr int PIN_ETH_MDC       = 4;   // GPIO4
constexpr int PIN_ETH_MDIO      = 13;  // GPIO13

// ---- RS485 (Serial2) ----
// IMPORTANTE: PIN_RS485_DE tiene logica INVERTIDA por optocoupler EL357N.
// HIGH al GPIO = receive mode. LOW al GPIO = transmit mode.
// Mantener HIGH durante todo el ciclo de vida para sniffing pasivo.
constexpr int PIN_RS485_RX = 36;   // GPIO36 (input-only)
constexpr int PIN_RS485_TX = 17;   // GPIO17 (interno)
constexpr int PIN_RS485_DE = 16;   // GPIO16 -- Driver Enable (logica invertida)

// ---- CAN Bus (TWAI nativo) ----
constexpr int PIN_CAN_RX = 35;     // GPIO35 (input-only)
constexpr int PIN_CAN_TX = 32;     // GPIO32 (interno)

// ---- Bus SPI expuesto en header GPIO ----
constexpr int PIN_SPI_SCK  = 14;   // P14
constexpr int PIN_SPI_MOSI = 12;   // P12 (strapping pin: LOW al boot)
constexpr int PIN_SPI_MISO = 39;   // P39 (input-only)
constexpr int PIN_SPI_CS   = 5;    // P5

// ---- Bus I2C expuesto en header ----
constexpr int PIN_I2C_SDA = 18;    // P18
constexpr int PIN_I2C_SCL = 23;    // P23

// ---- UART1 reservado para futuro modulo 4G PCIe ----
constexpr int PIN_UART1_TX = 33;   // P33
constexpr int PIN_UART1_RX = 34;   // P34 (input-only)
