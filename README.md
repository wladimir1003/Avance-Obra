## Datos y compatibilidad

- XML nativo de Project xer: curvas diarias de los segmentos del archivo y observación física disponible en la fecha de revisión.
- MPP moderno en formato interno MPP14: lectura de la jerarquía, fechas y datos disponibles. Los MPP antiguos requieren exportar a XML de Microsoft Project o usar el conversor de la edición Windows. El lector MPP del navegador expone un subconjunto de campos.
- XML de Microsoft Project (MSPDI), Primavera XER y Primavera XML (PMXML): importación local de actividades y jerarquías.
- Para XML de Microsoft Project, Primavera XML y XER se reparten los totales según los minutos laborables entre inicio y fin. Este reparto estima la distribución diaria cuando solo hay totales. Para MPP importado directamente se presenta un perfil acumulado por terminación. El programa agrega la duración al fin de cada actividad; los campos desconocidos se muestran sin dato. Este criterio se indica en la interfaz y en el informe. Para reproducir los segmentos diarios del motor Windows, abra el XML intermedio emitido por Importar.java. Desde la carpeta de la entrega de Windows, con Java disponible, por ejemplo:

      java -cp "motor;motor/lib/*" Importar "original.mpp" "distribucion.xml"

  Seleccione distribucion.xml en el navegador. Para el XML de Tracker con segmentos, abra el archivo directamente.
- La línea base externa debe tener identificadores únicos y concordantes con el proyecto activo. La fecha de control se interpreta al inicio del día. El período de próximos vencimientos es de siete días.
- El ZIP solo incluye los archivos del sitio, sin las muestras de prueba ni datos del usuario.

## Componentes

La carpeta vendor incluye el código fuente del lector MPP de danielestop/mpp-viewer, revisión 535b7cdc4b03b4d00e1e51843e235285405fa1b7, y cfb 1.2.2 de SheetJS. Se conservan los avisos y licencias. Se conservan los módulos originales como referencia. La página publicada ejecuta el código incluido en index.html; editar los módulos externos no modifica esta edición independiente.

Documentación de publicación: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
