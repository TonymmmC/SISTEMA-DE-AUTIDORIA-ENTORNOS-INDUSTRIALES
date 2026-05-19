#pragma once

namespace edge {

// Inicializa el servidor HTTP asincrono.
// Monta LittleFS y sirve archivos estaticos desde la raiz.
// Debe llamarse despues de initNetwork() y antes que cualquier handler custom.
// Retorna true si todo OK.
bool initWebServer();

}  // namespace edge
