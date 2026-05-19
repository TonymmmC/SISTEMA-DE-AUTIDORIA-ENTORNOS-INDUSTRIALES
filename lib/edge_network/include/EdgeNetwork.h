#pragma once

#include <Arduino.h>
#include <IPAddress.h>

namespace edge {

// Inicializa Ethernet y mDNS.
// Bloquea hasta obtener IP por DHCP o timeout (10s).
// Retorna true si Ethernet quedo operativo, false si fallo.
bool initNetwork();

// IP local asignada por DHCP. IPAddress() si Ethernet no esta operativo.
IPAddress getLocalIP();

// Indica si el link esta activo y la IP es valida.
bool isOnline();

}  // namespace edge
