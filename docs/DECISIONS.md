# Decisiones de diseño

> Este documento captura las decisiones tomadas antes de escribir código, junto
> con las alternativas consideradas.

Para la búsqueda y sustitución de palabras claves y frases se opto por usar el algoritmo de Aho-Corasick se cubre en profundidad en
[ALGORITHM.md](ALGORITHM.md);

## Semántica de matching

### Matching case-insensitive por defecto

**Decisión.** Pensando en la UX del usuario final y evitarle la molestia de censurar la palabra o frase en todas las posibles combinaciones de caracteres (por ejemplo beer, Beer, BeAr, etc) se ha tomado la decisión de que el matching de patrones sea case-insensitive a menos que se indique lo contrario explícitamente con `options.caseSensitive: true`.

**Código.** [matcher-options.interface.ts](../src/redaction/interfaces/matcher-options.interface.ts),
[text-transform.ts](../src/redaction/matchers/text-transform.ts).

### Matching agresivo de substring por defecto

**Decisión.** Los patrones coinciden en cualquier lugar dentro del texto por
defecto. Se modifica con `options.wordBoundaries: true`.

**Alternativas consideradas.** Se censura solo la palabra intentando ser lo más purista con el ejercicio pero pienso que se debería censurar la palabra completa para evitar ser detectada siguiendo patrones, por ejemplo si se agrega la frase "eat" y se tiene el texto "Meat" se debería censurar la palabra completa y no simplemente "MXXXX".

**Código.** [aho-corasick.service.ts](../src/redaction/matchers/aho-corasick.service.ts),
[matcher-options.interface.ts](../src/redaction/interfaces/matcher-options.interface.ts).

### Normalización Unicode OFF por defecto

**Decisión.** `normalizeUnicode` por defecto es `false` pensando a que se usara con el lenguaje en inglés pero se agrega debido al idioma español.

**Código.** [text-transform.ts](../src/redaction/matchers/text-transform.ts),
[matcher-options.interface.ts](../src/redaction/interfaces/matcher-options.interface.ts).

### Normalización de espacios dentro de frases OFF por defecto

**Decisión.** Los patrones multi-palabra coinciden con su secuencia exacta de
espacios. Colapsar `"cheese  pizza"` (dos espacios) contra `"cheese pizza"`
(un espacio) requiere opt-in.

**Alternativas consideradas.** Colapsar secuencias de espacios a un único
espacio por defecto.

**Por qué se rechazaron.** Los espacios en blanco son la forma más común de caer en el no-match y pensando en el UX se omite por posible typo.

**Código.** [text-transform.ts](../src/redaction/matchers/text-transform.ts).

### Política de superposición leftmost-longest, no configurable

**Decisión.** Cuando los patrones se superponen, el servicio emite la
coincidencia más a la izquierda, y dentro de una posición dada la coincidencia
más larga. Los prefijos más cortos o coincidencias embebidas son suprimidas.

**Código.** [aho-corasick.service.ts](../src/redaction/matchers/aho-corasick.service.ts),
[regex.service.ts](../src/redaction/matchers/regex.service.ts).

## Token de redacción

### Token fijo `XXXX`, no proporcional a la longitud

**Decisión.** Cada coincidencia es reemplazada por la cadena literal de cuatro
caracteres `XXXX`, independiente de la longitud de la coincidencia siguiendo las instrucciones de forma literal.

**Código.** [redaction.service.ts](../src/redaction/redaction.service.ts),
constante `REDACTION_TOKEN`.

### No colapsar redacciones consecutivas

**Decisión.** Las coincidencias adyacentes o superpuestas cada una produce su
propio token `XXXX`; no fusionamos `"XXXXXXXX"` en un solo `XXXX`.

**Alternativas consideradas.** Colapsar redacciones adyacentes en un solo
token.

**Por qué se rechazaron.** Colapsar cambia la aritmética de posición en la key
(los offsets de segmentos redactados ya no corresponden 1:1 a las ocurrencias
originales), lo que hace al flujo de unredact sustancialmente más difícil de
auditar. Preservar tokens por coincidencia mantiene la key como una lista
directa de reemplazos y hace que el roundtrip sea obviamente correcto.

**Código.** [redaction.service.ts](../src/redaction/redaction.service.ts).

## Parser de lista de censura

### Anidamiento estricto de comillas

**Decisión.** El parser de lista de censura acepta `"…"` y `'…'` como
delimitadores de frase. Las comillas dobles pueden contener comillas simples
como caracteres literales y viceversa, pero un tipo de comilla dado no puede
anidarse dentro de sí mismo.

**Alternativas consideradas.** Parser de comillas balanceadas con anidamiento
arbitrario, solo comilla simple, solo comilla doble.

**Por qué se rechazaron.** Básicamente para no incrementar la complejidad de combinaciones y basandose un poco en los lenguajes de programación

**Código.** [censor-list-parser.service.ts](../src/redaction/parsers/censor-list-parser.service.ts).

### Sin escapes de backslash

**Decisión.** El parser trata `\` como un carácter literal. No hay sintaxis de
escape para embeber caracteres de comilla dentro de una comilla del mismo tipo.

**Alternativas consideradas.** Escapes estilo lenguajes de programación (`\"`), escapes con comillas
dobladas (`""`), escapes estilo regex `\` para espacios y caracteres de
control.

**Por qué se rechazaron.** Básicamente para no incrementar la complejidad de combinaciones y basandose un poco en los lenguajes de programación

**Consecuencias.** `\n`, `\t`, y otros tokens estilo escape coinciden
literalmente si aparecen en la entrada. Los callers deben producir espacios
reales si los quieren.

**Código.** [censor-list-parser.service.ts](../src/redaction/parsers/censor-list-parser.service.ts).

### Fallar ante entrada inválida

**Decisión.** El parser devuelve `Result.err(ParseError)` en comillas
desbalanceadas, patrones solo-espacios, caracteres de control y otra entrada
malformada. No filtra ni repara silenciosamente.

**Alternativas consideradas.** Saltar entradas inválidas con una advertencia,
truncar al primer error, coaccionar comillas desbalanceadas a balanceadas.

**Por qué se rechazaron.** Mientras menos se pueda equivocar el usuario final, mejor!

**Código.** [censor-list-parser.service.ts](../src/redaction/parsers/censor-list-parser.service.ts),
[errors.ts](../src/common/errors.ts).

### La deduplicación respeta las opciones activas del matcher

**Decisión.** El paso de deduplicación del parser usa la misma normalización
que el matcher aplicará — si `caseSensitive: false` está activo, `"FOO"` y
`"foo"` se deduplican a una sola entrada.

**Alternativas consideradas.** Deduplicación siempre case-sensitive, sin
deduplicación.

**Por qué se rechazaron.** La deduplicación case-sensitive bajo un matcher
case-insensitive produce patrones duplicados en el trie, desperdiciando
memoria y ralentizando el compile sin ganancia semántica. Saltar la
deduplicación por completo permite que entradas patológicas inflen el trie.

**Código.** [censor-list-parser.service.ts](../src/redaction/parsers/censor-list-parser.service.ts).

## Arquitectura

### API dual — `redact()` de alto nivel y `compile()` / `match()` de bajo nivel

**Decisión.** El servicio expone dos niveles de abstracción sobre la misma
maquinaria de matching: un método de alto nivel para el caso común y dos
primitivas de bajo nivel para el futuro endpoint batch. En resumen simplicidad de uso vs. control fino sobre los recursos.

**Método de alto nivel — `redact(text, rawList, options)`.** Una sola llamada
ejecuta el pipeline completo internamente:

```
parsea      → CensorListParser convierte "a,'b c',d" en [a, "b c", d]
compila     → AhoCorasickMatcher construye el trie + failure links
empareja    → recorre el texto con el autómata y obtiene coincidencias
chunks      → inserta XXXX en cada coincidencia y arma el texto redactado
serializa   → empaqueta los mappings en la key (JSON + gzip + base64url)
```

Es el método que consume el endpoint `POST /redactions`. La entrada es un par
(texto + patrones) y la salida un único objeto `{ redactedText, key, stats }`.
El caller no necesita conocer ni orquestar ningún paso intermedio.

**Primitivas de bajo nivel — `compile(patterns, options)` y `match(text,
compiled)`.** Son dos operaciones independientes del matcher:

- `compile(patterns, options)` construye el autómata una sola vez y devuelve
  un `CompiledMatcher` congelado (`Object.freeze`), seguro para reusar entre
  solicitudes concurrentes.
- `match(text, compiled)` recibe ese `CompiledMatcher` ya construido y
  únicamente escanea el texto; no compila nada.

Este es el patrón **prepared-statement** familiar de los drivers SQL. Hoy los
endpoints HTTP solo procesan un documento por request, así que la ventaja de
reutilización **no se materializa en producción**. La dualidad existe por
tres razones:

1. **Testing aislado.** Los specs del matcher pueden ejercitar `compile()` y
   `match()` directamente, sin arrastrar el parser, el serializador de key,
   ni el builder de chunks al escenario de prueba. Eso mantiene cada suite
   enfocado en una sola responsabilidad.
2. **Diseñarlo ahora es barato; agregarlo después, caro.** Exponer las dos
   primitivas desde el día 1 son unas pocas líneas de contrato. Introducirlas
   más tarde implicaría reescribir la interfaz pública del servicio cuando ya
   tenga consumidores.
3. **Preparación para el endpoint batch.** El futuro
   `POST /redactions/batch` (listado en la sección "Lo que no decidimos")
   podrá compilar el trie una sola vez y reutilizarlo con
   `redactWithCompiled(text, compiled)` sobre cada documento, sin tocar los
   internos del matcher ni reparsear la lista de censura.

**Código.** [redaction.service.ts](../src/redaction/redaction.service.ts),
[matcher.interface.ts](../src/redaction/interfaces/matcher.interface.ts).

### Buffer de chunks en memoria, no concatenación de strings

**Decisión.** Para construir el texto redactado final, guardamos cada fragmento del texto original entre coincidencia y coincidencia, más
cada `XXXX`— en un arreglo, y al final unimos todo con un solo
`array.join('')`. Así el string completo se arma una única vez.

**Alternativas consideradas.**

- **Ir pegando texto con `+=`** a una variable: `resultado = resultado + pedazo`.
- **Usar `Buffer`**, el tipo de Node para manejar bytes crudos.
- **Usar una estructura llamada "rope"**, pensada para editores de texto con
  documentos enormes.

**Por qué se rechazaron.**

- **`+=` es lento para strings largos.** En JavaScript, cada `+=` crea un
  string nuevo copiando todo lo anterior. Para un documento grande con
  muchos matches, el costo crece al cuadrado: duplicar el tamaño cuadruplica
  el tiempo. El arreglo + `join('')` evita ese problema porque solo arma el
  string final una vez.
- **`Buffer` trabaja con bytes, no con caracteres.** Nuestro matcher entrega
  posiciones de caracteres (donde un emoji como `🎯` es un carácter, aunque
  ocupe varios bytes). Usar `Buffer` obligaría a convertir entre caracteres
  y bytes constantemente, lo que complica el código sin beneficio.
- **Rope es sobreingeniería a esta escala.** Es una estructura optimizada
  para documentos de cientos de MB (editores tipo VS Code). A nuestro
  límite de 10 MB, un arreglo simple ya es más que suficiente y mucho más
  fácil de leer.

**Código.** [redaction.service.ts](../src/redaction/redaction.service.ts).

### Implementar API REST

**Decisión.** Implementar los endpoints:
`POST /redactions` y `POST /redactions/unredact` como API REST ya que así sería más facil de escalar.

**Código.** [redaction.controller.ts](../src/redaction/redaction.controller.ts),
[health.controller.ts](../src/health/health.controller.ts).

### NestJS sobre Express puro

**Decisión.** La capa HTTP está construida sobre NestJS 11 con módulos,
providers, pipes, filters e interceptors, no sobre Express directamente.

**Alternativas consideradas.** Express puro, Fastify, Koa.

**Por qué se rechazaron.** Express puro requiere reescribir el scaffolding de
inyección de dependencias, validación, documentación y manejo de errores que
Nest provee out of the box. El assignment juzga la calidad del código tanto
como la correctitud funcional; construir código glue desde cero o duplicaría
la infraestructura de Nest o escatimaría en la validación. Fastify y Koa
tienen el mismo problema con menos conveniencias downstream.

**Código.** [app.module.ts](../src/app.module.ts),
[main.ts](../src/main.ts), `src/redaction/*.module.ts`, `src/health/*.module.ts`.

## Reversibilidad

### Key autocontenida — JSON, gzippeado, codificado en base64url

**Decisión.** La key funciona como un "recibo" que lista cada reemplazo
hecho — por ejemplo: _"en la posición 7 había la frase 'Cheese Pizza'"_.
Ese recibo se arma en tres pasos:

1. Se guarda como un objeto JSON con todos los reemplazos.
2. Se comprime con **gzip** (el mismo algoritmo de los archivos `.gz`) para
   que ocupe menos espacio.
3. Se convierte a **base64url**, un formato de texto seguro para viajar en
   una URL o un body HTTP sin necesidad de escaparse.

El resultado es una sola cadena que se devuelve junto al texto redactado y
se reenvía tal cual al llamar `POST /redactions/unredact`. El servidor no
guarda nada — toda la información vive en la key misma.

El tamaño de la key es aproximadamente proporcional a lo
que se redactó. Si el documento tiene muchas coincidencias o patrones muy
largos, la key crece. Por eso hay un límite de 1 MB en la key a nivel de
DTO — evita que un documento malicioso genere una respuesta gigantesca.

**Código.** [key-serializer.service.ts](../src/redaction/keys/key-serializer.service.ts),
[redaction-key.ts](../src/redaction/keys/redaction-key.ts).

### Ofuscación, no criptografía

**Decisión.** La key es gzippeada y codificada en base64url. No está firmada,
ni cifrada, ni autenticada.

**Código.** [key-serializer.service.ts](../src/redaction/keys/key-serializer.service.ts).

## Seguridad

### El logging nunca emite body, patrones ni key

**Decisión.** El interceptor de logging emite método, ruta, estado, duración,
hashes del body y de los patrones, y la longitud de la key. Nunca loggea el
body completo de la solicitud, la lista de patrones, la key, el texto
redactado, o el texto original.

Para Debuguear una solicitud de redacción específica solo desde
logs no es posible; la reproducción requiere re-correr la solicitud. Este es
un costo aceptable para un servicio de redacción, y los hashes son suficientes
para correlacionar logs con registros del lado cliente.

**Código.** [logging.interceptor.ts](../src/common/interceptors/logging.interceptor.ts).

### Límites de entrada aplicados en DTOs

**Decisión.** El texto del documento está acotado a 10 MB, la lista de
patrones a 1 MB y 10 000 entradas, y cada patrón individual a 1 000
caracteres. El payload de key está acotado a 1 MB. La aplicación sucede en la
capa DTO vía decoradores de `class-validator`, antes de que el servicio vea
cualquier dato.

Los límites están documentados en
[limits.ts](../src/common/limits.ts) y se superficializan en los errores de
validación DTO.

**Código.** [limits.ts](../src/common/limits.ts),
[redact-request.dto.ts](../src/redaction/dto/redact-request.dto.ts),
[unredact-request.dto.ts](../src/redaction/dto/unredact-request.dto.ts).

### `Result<T, E>` para fallos esperados, `throw` para invariantes

**Decisión.** El parsing, deserialización, aplicación de límites y chequeos de
integridad devuelven variantes `Result<T, E>` con tipos de error de unión
discriminada. Las excepciones solo se lanzan cuando se viola un invariante
(p. ej. se pasa un matcher compilado de otra implementación).

El patrón del controlador es `if (!result.ok) throw new
DomainHttpException(result.error)`. La capa de filter lee el tipo de error
desde la excepción y emite el envelope uniforme de error.

**Código.** [result.ts](../src/common/result.ts),
[errors.ts](../src/common/errors.ts),
[domain-http.exception.ts](../src/common/filters/domain-http.exception.ts).

### Tipos branded para evitar confundir argumentos

**Decisión.** Aunque los cuatro valores `Pattern`, `RedactionKey`,
`RedactedText` y `OriginalText` son por debajo simples `string`, los
declaramos como **tipos distintos** para que TypeScript no permita
confundirlos entre sí.

**Alternativas consideradas.** Usar `string` plano en todas partes y
confiar en los nombres de los parámetros para documentar qué significa
cada uno.

**Por qué se rechazó.** TypeScript solo valida tipos, no nombres de
parámetros. Si una función se declara así:

```typescript
unredact(redactedText: string, key: string)
```

nada impide llamarla con los argumentos invertidos:

```typescript
unredact(miKey, miTextoRedactado); // ⚠️ Compila sin error
```

Ambos son `string`, así que el compilador los acepta y el bug solo se
descubre en runtime. Con tipos branded, el mismo error falla en
compilación:

```typescript
unredact(miKey, miTextoRedactado); // ❌ RedactionKey no es RedactedText
```

**Código.** [brand.ts](../src/common/brand.ts),
[redaction-key.ts](../src/redaction/keys/redaction-key.ts),
`src/redaction/parsers/pattern.ts`.

## Bloque G — Elección de algoritmo

### Aho-Corasick como algoritmo de búsqueda

**Decisión.** El matching de producción usa la implementación Aho-Corasick en
`AhoCorasickMatcher`.

**Alternativas consideradas.** Ver la tabla de comparación en
[ALGORITHM.md §7](ALGORITHM.md#7-comparison-with-alternatives).

**Por qué se rechazaron.** Diferido a [ALGORITHM.md](ALGORITHM.md) — el
racional cubre complejidad, determinismo y auditabilidad de una forma que
pertenece con la explicación algorítmica en vez de aquí.

**Consecuencias.** La capa de servicio depende solo de la interfaz `Matcher`,
así que intercambiar implementaciones es un solo cambio de binding de
Inversión de Dependencias en una posible Fase 2.

**Código.** [aho-corasick.service.ts](../src/redaction/matchers/aho-corasick.service.ts),
[redaction.module.ts](../src/redaction/redaction.module.ts).

## Pruebas

### Pruebas basadas en propiedades con `fast-check`

**Decisión.** La correctitud del matcher está cubierta por pruebas basadas en
propiedades que generan patrones y texto aleatorios, corren ambos matchers y
afirman salidas idénticas.

**Código.** [matchers.property.spec.ts](../src/redaction/matchers/matchers.property.spec.ts).

## API HTTP

### `POST /redactions`, no `GET`

**Decisión.** El endpoint de redacción usa `POST` aunque la operación es
nominalmente de solo lectura con respecto al estado del servidor.

**Alternativas consideradas.** `GET /redactions?text=…&patterns=…`, `PUT`.

**Por qué se rechazaron.** `GET` pone el documento en la URL, que termina en
logs de acceso, cachés de proxy, historial del navegador y cualquier
intermediario que almacene la línea de solicitud. Para un servicio de
redacción eso es el peor lugar posible para que aparezca el texto original.
`POST` mantiene el payload en el body.

**Código.** [redaction.controller.ts](../src/redaction/redaction.controller.ts).

## TypeScript

### Modo strict completo más `noUncheckedIndexedAccess` y `exactOptionalPropertyTypes`

**Decisión.** `tsconfig.json` habilita `strict: true`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitOverride`, `noFallthroughCasesInSwitch` y
`noPropertyAccessFromIndexSignature`.

El acceso a arreglos típicamente devuelve `T | undefined`
y debe ser refinado. Las propiedades opcionales no pueden ser asignadas
explícitamente a `undefined`. Esto agrega un puñado de guardas pero atrapa
los errores exactos que dejarían filtrar `undefined` a producción.

**Código.** [tsconfig.json](../tsconfig.json).

### Sin prefijo `I` en interfaces

**Decisión.** Los nombres de interfaces siguen la guía de estilo de
TypeScript: `Match`, `Matcher`, `CompiledMatcher`, no `IMatch`, `IMatcher`.

**Código.** [src/redaction/interfaces/](../src/redaction/interfaces/).
