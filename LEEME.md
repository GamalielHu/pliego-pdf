# Pliego · Editor PDF (programa para Windows)

Editor PDF de escritorio: edita el texto que ya está en el PDF, reconoce texto en escaneos (OCR en español e inglés), organiza y rota páginas, agrega textos, firmas, formas y resaltados, imprime y exporta a PDF, Word, Excel, imagen y texto. Funciona **sin internet**.

## Cómo obtener el .exe (compilado por GitHub, igual que tus otras apps)

1. En GitHub crea un repositorio nuevo, por ejemplo `pliego-pdf` (puede ser privado).
2. Sube **todo** el contenido de esta carpeta, incluida la carpeta oculta `.github`.
   - Si la subes desde la web y la carpeta `.github` no aparece, créala a mano: *Add file → Create new file*, escribe como nombre `.github/workflows/compilar.yml` y pega el contenido de ese archivo.
3. Entra a la pestaña **Actions**. La compilación arranca sola (tarda unos 5 a 8 minutos). Si no arranca, elige *Compilar Pliego para Windows → Run workflow*.
4. Cuando termine con el check verde, abre la ejecución y descarga **Pliego-Windows** (abajo, en *Artifacts*). Es un .zip con dos programas:
   - `Pliego-Instalador-1.0.0.exe`: lo instala, crea acceso directo en el escritorio y en el menú Inicio, y permite abrir PDF con *clic derecho → Abrir con → Pliego*.
   - `Pliego-Portable-1.0.0.exe`: se ejecuta sin instalar (útil en una memoria USB).
5. Windows mostrará «Windows protegió su PC» porque el programa no está firmado: pulsa **Más información → Ejecutar de todos modos**.

## Atajos

| Acción | Teclas |
|---|---|
| Guardar sobre el mismo archivo | Ctrl+S |
| Guardar como / exportar | Ctrl+Shift+S |
| Abrir | Ctrl+O |
| Imprimir | Ctrl+P |
| Buscar | Ctrl+F |
| Deshacer / rehacer | Ctrl+Z / Ctrl+Y |
| Herramientas | V seleccionar, E editar texto, T texto, H resaltar, P lápiz, R rectángulo, W corrector, M mover zona |

## Para probar en la PC sin compilar (opcional)

Con Node.js 20 instalado: `npm install` y luego `npm start`.

## Estructura

- `www/index.html` — el editor completo (es el mismo código que usará la app de celular).
- `main.js`, `preload.js` — la ventana de Windows: abrir y guardar archivos, doble clic en PDF, aviso de cambios sin guardar.
- `scripts/vendor.js` — copia las librerías y descarga los idiomas del OCR dentro del programa.
- `.github/workflows/compilar.yml` — la compilación automática en GitHub.
