#pragma once

#include <Arduino.h>
#include <IPAddress.h>
#include <ctime>

namespace edge {

// Inicializa Ethernet, mDNS y NTP (no bloqueante).
// Bloquea hasta obtener IP por DHCP o timeout (10s).
// Retorna true si Ethernet quedo operativo, false si fallo.
bool initNetwork();

// IP local asignada por DHCP. IPAddress() si Ethernet no esta operativo.
IPAddress getLocalIP();

// Indica si el link esta activo y la IP es valida.
bool isOnline();

// true si NTP devolvio hora valida (epoch > 2023).
bool horaSincronizada();

// Epoch UTC actual. Retorna 0 si NTP no ha sincronizado.
time_t ahoraUTC();

}  // namespace edge
