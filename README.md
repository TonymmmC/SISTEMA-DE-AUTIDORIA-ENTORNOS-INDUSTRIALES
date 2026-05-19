# Sistema Auditoria Edge101

Firmware para el DFRobot Edge101 (DFR0886). Sistema de monitoreo y auditoria
de seguridad en redes industriales IIoT.

Proyecto academico -- UNIFRANZ, Programacion de Sistemas Embebidos, gestion I-2026.

## Prerequisitos

- VS Code con extension PlatformIO IDE instalada
- Driver USB CH9102F (Windows). Descargar desde www.wch.cn si el puerto COM
  no aparece al conectar el Edge101.
- Cable USB Type-C
- Cable Ethernet RJ45 conectado al router

## Como compilar y flashear

1. Clonar este repo:
   ```
   git clone <url-del-repo>
   cd sistema-auditoria-edge101
   ```

2. Abrir la carpeta en VS Code. PlatformIO detecta el proyecto y descarga
   automaticamente toolchain y librerias la primera vez (tarda unos minutos).

3. Conectar el Edge101 al PC por USB Type-C.

4. Compilar y flashear:
   - Boton flecha derecha en la barra inferior de VS Code (`Upload`), o
   - Terminal: `pio run -e edge101 --target upload`

5. Subir el dashboard a LittleFS (solo la primera vez o cuando cambien archivos
   en `data/`):
   - `pio run -e edge101 --target uploadfs`

6. Abrir el monitor serial para ver los logs de boot:
   - Boton enchufe en la barra inferior, o
   - Terminal: `pio device monitor`

## Como acceder al dashboard

1. Conectar el Edge101 al router con cable RJ45.
2. Esperar el log "mDNS registrado: edge101.local" en el monitor serial.
3. Abrir en el navegador: `http://edge101.local`

Si mDNS no funciona en tu red, el monitor serial mostrara la IP asignada
por DHCP. Usar esa IP directamente: `http://<ip>`.

## Troubleshooting

**El puerto COM no aparece en VS Code:**
Instalar el driver CH9102F desde el sitio de WCH (www.wch.cn).

**`mdns` no resuelve `edge101.local`:**
Algunas redes corporativas bloquean mDNS. Usar la IP directa que aparece
en el monitor serial.

**El monitor serial muestra caracteres raros:**
Verificar que la velocidad este en 115200 bps.

**El upload falla con "timeout":**
Mantener presionado el boton BOOT del Edge101 durante el inicio del flasheo,
soltar cuando aparezca "Connecting".

## Reportar problemas

Cuando flashees y haya errores o comportamiento inesperado, copiar la salida
completa del monitor serial y enviarla al dev junto con la descripcion de
que se intentaba hacer.

## Desarrollo local del dashboard (solo para el dev)

El dashboard se puede iterar sin flashear el Edge101. Desde la raiz del
proyecto:

    cd data
    python -m http.server 8080

Abrir http://localhost:8080. El dashboard renderiza con datos simulados
(aparece la leyenda "modo desarrollo local -- data simulada" en el header).
Cuando se flashea al Edge101 y se accede por http://edge101.local, los
datos pasan a ser reales automaticamente.
