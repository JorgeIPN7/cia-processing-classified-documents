# CIA Document Redactor

![Node](https://img.shields.io/badge/Node-%E2%89%A522-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)
![Tests](https://img.shields.io/badge/tests-231%20unit%20%2B%2024%20e2e-brightgreen)

Servicio stateless que redacta documentos de texto — inserta `XXXX` en los
lugares donde aparecen los keywords y frases censurados — y permite
revertirlos al original usando una key opaca. Resuelto con NestJS 11 y
TypeScript estricto.

## Los assignments que resuelve

| Part | Qué pide el enunciado                                             | Endpoint                    | Input → Output                                        |
| ---- | ----------------------------------------------------------------- | --------------------------- | ----------------------------------------------------- |
| 1    | Remover keywords y frases de un texto y reemplazarlos con `XXXX`. | `POST /redactions`          | `{ text, patterns }` → `{ redactedText, key, stats }` |
| 2    | Revertir un texto redactado usando una key.                       | `POST /redactions/unredact` | `{ redactedText, key }` → `{ text, stats }`           |

### Variante por archivos (`.txt` / `.md`)

Para operar directamente con documentos sin copiar-pegar texto en JSON, hay
tres endpoints adicionales sobre `multipart/form-data`:

| Endpoint                       | Método | Uso                                                                                                      |
| ------------------------------ | ------ | -------------------------------------------------------------------------------------------------------- |
| `POST /redactions/file`        | async  | Sube un `.txt`/`.md` → responde `{ id, downloadUrl, key, expiresInSeconds, stats }`                      |
| `GET /redactions/file/:id`     | async  | Descarga **una sola vez** el archivo redactado (TTL 5 min). Tras leerlo, se borra del servidor.          |
| `POST /redactions/unredact/file` | sync | Sube el `.txt`/`.md` redactado + `key` → responde el archivo restaurado inline. El original nunca toca disco. |

## Probar en 1 minuto

Requisitos: Node.js ≥ 22 y pnpm ≥ 9.

```bash
git clone <repo-url>
cd cia-processing-classified-documents
pnpm install
cp .env.example .env
pnpm run start:dev
```

Roundtrip completo — redactar y revertir en una sola tirada:

```bash
# 1) Redactar
RESULT=$(curl -s -X POST http://localhost:8888/redactions \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "The Boston Red Sox ordered a Cheese Pizza.",
    "patterns": "\"Boston Red Sox\" \"Cheese Pizza\""
  }')
echo "Redactado: $RESULT"

# 2) Revertir con la key devuelta
KEY=$(echo "$RESULT" | jq -r .key)
REDACTED=$(echo "$RESULT" | jq -r .redactedText)
curl -s -X POST http://localhost:8888/redactions/unredact \
  -H 'Content-Type: application/json' \
  -d "{\"redactedText\": \"$REDACTED\", \"key\": \"$KEY\"}"
```

Roundtrip equivalente usando archivos:

```bash
# 1) Redactar un archivo — devuelve id, URL de descarga y key
echo "The Boston Red Sox ordered a Cheese Pizza." > doc.txt
RESP=$(curl -s -X POST http://localhost:8888/redactions/file \
  -F 'patterns="Boston Red Sox" "Cheese Pizza"' \
  -F 'file=@doc.txt;type=text/plain')
echo "Redactado: $RESP"

# 2) Descargar el archivo redactado (single-use, TTL 5 min)
URL=$(echo "$RESP" | jq -r .downloadUrl)
KEY=$(echo "$RESP" | jq -r .key)
curl -s -o doc.redacted.txt "$URL"

# 3) Restaurar: sube el archivo redactado + key → baja el original
curl -s -o doc.restored.txt -X POST http://localhost:8888/redactions/unredact/file \
  -F "key=$KEY" \
  -F 'file=@doc.redacted.txt;type=text/plain'
```

Restricciones de archivo: extensiones permitidas `.txt` y `.md`, tamaño máximo
`MAX_DOCUMENT_BYTES` (10 MB por defecto), encoding UTF-8 asumido. La URL de
descarga es absoluta y respeta `X-Forwarded-Proto` / `X-Forwarded-Host`
detrás de proxies. Variables de entorno opcionales:
`REDACTION_FILE_STORAGE_DIR` (default `./tmp/redactions`) y
`REDACTION_FILE_TTL_SECONDS` (default `300`).

Explorar la API interactivamente en Swagger UI:
[http://localhost:8888/api/docs](http://localhost:8888/api/docs).

Una request pasa por validación de DTO, llega al controlador, que orquesta
parser + matcher + serializador de key dentro del `RedactionService`, y
regresa al cliente. Cualquier error de dominio se convierte en un envelope
uniforme vía el `HttpExceptionFilter` global.

## Decisiones técnicas destacadas

- **Aho-Corasick como algoritmo de matching.** Un solo recorrido del texto
  en `O(n + m + Z)` sin importar cuántos patrones haya en la lista —
  determinista, sin backtracking, auditable. Ver el deep dive en
  [docs/ALGORITHM.md](docs/ALGORITHM.md).

- **Property-based testing con `fast-check`.** Se cruzan las
  implementaciones `AhoCorasickMatcher` y `RegexMatcher` contra 1000+ inputs
  generados aleatoriamente y se afirma que producen el mismo resultado.
  Ninguno es el oráculo; el acuerdo entre dos implementaciones
  independientes es la evidencia. Ver
  [docs/DECISIONS.md — Pruebas basadas en propiedades](docs/DECISIONS.md).

- **Tipos branded en TypeScript.** `Pattern`, `RedactionKey`, `RedactedText`
  y `OriginalText` son tipos distintos aunque por debajo sean `string`. El
  compilador rechaza confundir, por ejemplo, una `RedactionKey` con un
  `RedactedText` — bug invisible con `string` plano. Ver
  [docs/DECISIONS.md — Tipos branded](docs/DECISIONS.md).

- **Key autocontenida (JSON + gzip + base64url).** El "recibo" de todos los
  reemplazos viaja en la respuesta y se reenvía tal cual al endpoint de
  reversión. El servidor no guarda nada — sin base de datos, sin estado.
  Ver [docs/DECISIONS.md — Key autocontenida](docs/DECISIONS.md).

## Stack y testing

| Área                 | Elección                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Framework            | NestJS 11 (modules, providers, pipes, filters, interceptors)                               |
| Lenguaje             | TypeScript estricto (`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) |
| Package manager      | pnpm                                                                                       |
| Tests unitarios      | Jest — 231 tests                                                                           |
| Tests end-to-end     | supertest contra `AppModule` real — 24 tests                                               |
| Tests property-based | `fast-check` — 10 propiedades con 1000+ iteraciones cada una                               |
| Docs de API          | OpenAPI vía `@nestjs/swagger` en `/api/docs`                                               |
| Linting              | ESLint + `typescript-eslint` con preset `strict-type-checked`                              |

Ejecutar la suite completa:

```bash
pnpm test        # 231 unitarios
pnpm test:e2e    # 24 end-to-end
pnpm test:cov    # con reporte de cobertura
```

## Documentación profunda

| Documento                              | Contenido                                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Cada decisión de diseño con alternativas consideradas, por qué se rechazaron, y huella en el código.                 |
| [docs/ALGORITHM.md](docs/ALGORITHM.md) | Aho-Corasick: intuición, complejidad formal, comparación con 5 alternativas, diagrama del trie con enlaces de fallo. |
