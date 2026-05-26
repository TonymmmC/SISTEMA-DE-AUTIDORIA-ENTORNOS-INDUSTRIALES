#pragma once
#include <cstddef>

namespace edge {

// Inicializa SPI y SD. Crea /audit si no existe.
// Retorna false si no hay tarjeta -- NO es error fatal del sistema.
bool initStorage();

bool sdDisponible();

// Append de una linea ya formateada (terminada en '\n') al archivo del dia.
// Nombre calculado internamente desde ahoraUTC() -> YYYY-MM-DD.csv.
// Si no hay hora sincronizada usa "unsynced.csv".
bool appendAuditLine(const char* linea);

// Itera archivos en /audit. Callback recibe nombre y tamaño en bytes.
size_t listarArchivosAudit(void (*cb)(const char* nombre, size_t bytes));

}  // namespace edge
