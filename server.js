const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const { OpenAI } = require("openai");
require("dotenv").config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Función para extraer datos de la hoja de cálculo
const extractDataFromSheet = (buffer) => {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  return xlsx.utils.sheet_to_json(worksheet, { raw: false });
};

// Función para parsear el importe restante a un entero
const parseImporteRestante = (importe) => {
  return Math.trunc(parseFloat(importe.replace(/\./g, '').replace(',', '.')));
};

app.post('/upload', upload.single('file'), async (req, res) => {
  const cuotasPendientesSolicitadas = req.body.cuotasPendientes || '1';
  const jsonData = extractDataFromSheet(req.file.buffer);

  let sumasTotalesPorTarjeta = {};
  let tarjetaActual = null;

  jsonData.forEach(item => {
    if (item['__EMPTY_1'] && item['__EMPTY_1'].startsWith('Tarjeta VISA')) {
      tarjetaActual = item['__EMPTY_1'].match(/\bXXXX-\d{4}\b/)[0];
      sumasTotalesPorTarjeta[tarjetaActual] = {
        comprobantesUnicos: new Set(),
        sumaTotalRestante: 0,
        datos: []
      };
    }

    if (tarjetaActual && item['__EMPTY_5'] === cuotasPendientesSolicitadas) {
      const comprobante = item['__EMPTY_3']?.trim();
      const importeRestanteEntero = parseImporteRestante(item['__EMPTY_6']);

      if (!sumasTotalesPorTarjeta[tarjetaActual].comprobantesUnicos.has(comprobante)) {
        sumasTotalesPorTarjeta[tarjetaActual].comprobantesUnicos.add(comprobante);
        sumasTotalesPorTarjeta[tarjetaActual].sumaTotalRestante += importeRestanteEntero;
        sumasTotalesPorTarjeta[tarjetaActual].datos.push({
          cuotas_pendientes: item['__EMPTY_5'],
          comprobante: comprobante,
          importe_restante: importeRestanteEntero
        });
      }
    }
  });

  const respuestaPorTarjeta = Object.keys(sumasTotalesPorTarjeta).map(numeroTarjeta => {
    return {
      tarjeta: numeroTarjeta,
      datos: sumasTotalesPorTarjeta[numeroTarjeta].datos,
      sumaTotalRestante: sumasTotalesPorTarjeta[numeroTarjeta].sumaTotalRestante
    };
  });

  // Obtén consejos de OpenAI para cada tarjeta utilizando el modelo gpt-3.5-turbo
  for (const tarjeta of respuestaPorTarjeta) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "You are a financial advisor. in spanish, " },
          { role: "user", content: `I have a projected cash flow of ${tarjeta.sumaTotalRestante} for next month. What should I do with the extra money? recomienda comprar algun libro con nombre y autor de autoayuda o motivacional` }
        ],
        temperature: 0.7,
        max_tokens: 150,
      });

      // Agrega el consejo a la respuesta de la tarjeta correspondiente
      tarjeta.consejo = response.choices[0].message.content;
    } catch (error) {
      console.error('Error al obtener consejos de OpenAI:', error);
      tarjeta.consejo = "No se pudo obtener un consejo en este momento.";
    }
  }

  // Envía la respuesta con los consejos incluidos
  res.json(respuestaPorTarjeta);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

