# Control de proyectos · edición para GitHub Pages

1. Descomprima GitHub-Pages.zip y suba su contenido a la raíz de un repositorio. Mantenga la carpeta vendor y todos los archivos JavaScript junto a index.html en la estructura que trae el ZIP.
2. En Settings → Pages, seleccione Deploy from a branch, la rama que contiene los archivos (por ejemplo main), la carpeta /(root) y Save.
3. Abra la dirección que GitHub muestre en Pages una vez finalizada la publicación. El botón Abrir cronograma lee archivos del dispositivo del visitante. Los cronogramas de trabajo no deben subirse al repositorio para abrirlos.

También se distribuye Avance-independiente.html, con las bibliotecas incluidas en el mismo archivo. Se puede abrir con doble clic o publicar por sí solo con el nombre index.html. Esta edición no necesita el ejecutable Windows, Java, claves de API, CDN ni un servicio de datos. El estado de trabajo se conserva mientras permanezca abierta la página. Para guardar una salida, exporte el CSV o el informe HTML.

## Datos y compatibilidad

- XML nativo de Project Tracker: curvas diarias de los segmentos del archivo y observación física disponible en la fecha de revisión.
- MPP moderno en formato interno MPP14: lectura de la jerarquía, fechas y datos disponibles. Los MPP antiguos requieren exportar a XML de Microsoft Project o usar el conversor de la edición Windows. El lector MPP del navegador expone un subconjunto de campos.
- XML de Microsoft Project (MSPDI), Primavera XER y Primavera XML (PMXML): importación local de actividades y jerarquías.
- Al importar directamente cronogramas externos sin el motor Windows, se presenta un perfil acumulado por terminación. El programa agrega la duración al fin de cada actividad; los campos desconocidos se muestran sin dato. Este criterio se indica en la interfaz y en el informe. Para reproducir los segmentos diarios del motor Windows, abra el XML intermedio emitido por Importar.java. Desde la carpeta de la entrega de Windows, con Java disponible, por ejemplo:

      java -cp "motor;motor/lib/*" Importar "original.mpp" "distribucion.xml"

  Seleccione distribucion.xml en el navegador. Para el XML de Tracker con segmentos, abra el archivo directamente.
- La línea base externa debe tener identificadores únicos y concordantes con el proyecto activo. La fecha de control se interpreta al inicio del día. El período de próximos vencimientos es de siete días.
- El ZIP solo incluye los archivos del sitio, sin las muestras de prueba ni datos del usuario.

## Componentes

La carpeta vendor incluye el código fuente del lector MPP de danielestop/mpp-viewer, revisión 535b7cdc4b03b4d00e1e51843e235285405fa1b7, y cfb 1.2.2 de SheetJS. Se conservan los avisos y licencias. El código JavaScript de los módulos del sitio se puede editar directamente.

Documentación de publicación: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
