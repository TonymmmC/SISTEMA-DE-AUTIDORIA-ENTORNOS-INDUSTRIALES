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

// Append de un batch: abre el archivo una vez, escribe todas las lineas, cierra.
// Reduce desgaste y latencia de la SD (logs en bloques).
bool appendAuditBatch(const char* const* lineas, size_t count);

// Itera archivos en /audit. Callback recibe basename y tamaño en bytes.
size_t listarArchivosAudit(void (*cb)(const char* nombre, size_t bytes));

// True si /audit/<nombre> existe. Serializa el acceso al bus SD.
bool auditExists(const char* nombre);

}  // namespace edge
