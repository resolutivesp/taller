# Taller — RATE_KV paso a paso + análisis de riesgos

---

# PARTE 1 — RATE_KV, con clics exactos

## Antes de Cloudflare: blinda la clave en Anthropic

Esto es lo primero porque es **el único límite que no se puede saltar**. Todo lo demás son capas que reducen la probabilidad; esto pone un techo absoluto.

1. Ve a **console.anthropic.com/settings/workspaces**
2. **Create Workspace** → nómbralo `taller`
3. Dentro de ese workspace, **crea la API key ahí** (no una key general de la organización)
4. En el workspace, fija un **monthly spend limit** de **5-10 $**

Por qué así y no una key normal: si la clave se filtra alguna vez —un repo, un pantallazo, un log—, el daño máximo es ese tope mensual. Con una key de organización, el daño máximo es tu tarjeta.

## Crear el KV

1. dash.cloudflare.com → barra lateral izquierda → **Storage & Databases** → **KV**
2. **Create instance**
3. Nombre: `taller-rl` → **Create**

## Enlazarlo al worker

4. **Workers & Pages** → pulsa sobre tu worker (`taller-ai`)
5. Pestaña **Bindings** → **Add binding**
6. Tipo: **KV namespace**
7. **Variable name:** `RATE_KV` ← *exactamente así, en mayúsculas. El código busca ese nombre; si te equivocas, el worker sigue funcionando pero **sin límite**, en silencio.*
8. **KV namespace:** selecciona `taller-rl` del desplegable
9. **Add binding** → esto redespliega el worker solo

## Comprobar que de verdad está activo

Esto importa: un binding mal puesto no da error, simplemente no limita nada.

1. Abre `https://taller-ai.<tu-cuenta>.workers.dev` en el navegador. Debe responder `{"ok":true,"service":"taller-ai",...}`
2. Abre la app y haz **una pregunta** al asistente
3. Vuelve a **Storage & Databases → KV → taller-rl** y mira las claves

Si el binding funciona, verás aparecer entradas tipo `rl:2026-07-27:GLOBAL` y `rl:2026-07-27:<ip>`. **Si no aparece ninguna clave, el binding no está aplicado** — revisa que el nombre sea exactamente `RATE_KV` y que hayas pulsado *Add binding* (no solo cerrado el diálogo).

## ALLOWED_ORIGINS (recomendado, pero entiende qué hace)

1. Worker → **Settings** → **Variables and Secrets** → **Add**
2. Tipo: **Plain text** (no Secret)
3. Name: `ALLOWED_ORIGINS` · Value: `https://resolutivesp.github.io`

**Qué hace de verdad:** impide que *otra página web* llame a tu endpoint desde el navegador de un visitante. **Qué NO hace:** frenar a alguien con `curl`, porque la cabecera `Origin` la envía el navegador y cualquiera puede falsificarla. Es una capa útil contra el abuso casual, no una defensa.

Los frenos reales, por orden de fiabilidad: **tope de gasto del workspace** > **RATE_KV** > **ALLOWED_ORIGINS**.

---

# PARTE 2 — Los demás riesgos, por orden de probabilidad × coste

## 🔴 1. Tu email personal queda público y será rastreado

`js/config.js` línea 6 contiene `feedbackEmail: 'resolutivesp@gmail.com'`. Ese archivo va **en un repo público** y además **se sirve como archivo estático** en `https://resolutivesp.github.io/taller/js/config.js`. Los rastreadores de direcciones lo encontrarán en semanas.

No es un fallo: hace falta una dirección para recibir el feedback. Pero decide con los ojos abiertos:

- **Aceptarlo** — si `resolutivesp@` ya es tu cuenta de proyecto y no la personal, el coste es spam creciente para siempre en esa dirección.
- **Separarla** — crea una dirección solo para esto (`taller.feedback@…`) y redirígela a tu bandeja. Si un día se llena de basura, la tiras sin perder nada. Es un cambio de una línea.

Lo mismo aplica a firmar los mensajes con tu nombre real: es **lo correcto** para la credibilidad del proyecto (un desarrollador anónimo pidiendo que prueben una app médica no genera confianza), pero es información que ya no recuperas.

## 🔴 2. Tomar tu cuenta de GitHub = servir código malicioso a técnicos que confían

Este es el riesgo con **peores consecuencias reales**, aunque sea poco probable. La app es una PWA: se instala, se cachea y **sigue funcionando sin conexión durante semanas**. Si alguien entra en tu repo y sustituye un `.js`, cada técnico que abra el enlace instala ese código y lo conserva offline. Y el producto se llama a sí mismo "seguro, sin cuentas, nada sale de tu móvil".

Qué hacer, y es de verdad todo lo que hace falta:

- **2FA en GitHub** con app de autenticación (no SMS). Ahora mismo, antes de subir nada.
- **2FA en Cloudflare** también — esa cuenta guarda tu clave de Anthropic.
- Contraseña única en ambas (gestor de contraseñas).
- **No añadas colaboradores** al repo por comodidad. Si alguien quiere contribuir, que mande un Pull Request y lo lees línea a línea.
- Si algún día aceptas un PR: mira **todo** el diff. Un PR "arreglo un typo" que además toca `js/ask.js` es exactamente cómo se hace esto.

## 🟠 3. Responsabilidad legal: das consejo sobre equipos de los que dependen vidas

*No soy abogado y esto no es asesoramiento legal.* Lo que sí puedo decirte con precisión:

- **La licencia Apache-2.0 es tu protección principal.** Sus secciones 7 y 8 renuncian expresamente a garantías y limitan la responsabilidad. Es la razón por la que la licencia importa y no es un trámite. Que el `LICENSE` y el `NOTICE` sigan en el repo no es opcional.
- **El aviso dentro de la app importa igual.** La app ya muestra el aviso de seguridad en el asistente y "verifica en la página citada antes de actuar". No lo quites ni lo suavices por estética.
- **Mantenlo genuinamente no comercial.** Tanto el Reglamento de Ciberresiliencia europeo (CRA) como la Directiva de Responsabilidad por Productos Defectuosos (UE 2024/2853) contemplan excepciones para software libre desarrollado **fuera de una actividad comercial**. En cuanto haya monetización, patrocinio o un servicio de pago encima, ese análisis cambia por completo. Ahora mismo estás en el lado bueno; si algún día quieres monetizarlo, **consulta a un abogado antes**, no después.
- Dado tu contexto de autónomo en España: si en el futuro facturas algo relacionado con esto, la naturaleza del proyecto cambia. Merece una conversación con tu gestor.

## 🟠 4. Copyright: la regla que no puedes romper ni una vez

El proyecto es *clean-room* y eso es un activo. La regla operativa es simple:

**Nunca alojes un manual. Nunca. Ni uno.**

Habrá tentación: un técnico te escribirá agradecido ofreciéndote su carpeta de PDFs "para que los incluyas y así los demás no tengan que buscarlos". La respuesta es no. Hoy la app **solo enlaza** a iFixit, Frank's y MedWrench, y no copia nada — por eso no tienes exposición. El día que alojes un PDF de un fabricante, la tienes entera.

Lo mismo con el dispositivo de la demo: el "OpenMed SP-100" es ficticio y escrito desde cero **a propósito**. No lo sustituyas por un manual real "que se ve mejor".

## 🟡 5. Alguien puede forkear y publicar una versión hostil

Apache-2.0 permite forks, y eso es intencional. Alguien podría publicar una copia idéntica con un `aiEndpoint` apuntando a su servidor. No hay defensa técnica y tampoco debe haberla.

Lo único que puedes hacer: **sé el enlace canónico**. Usa siempre la misma URL en todos los canales, y que el README diga claramente cuál es el oficial. Si algún día aparece un clon raro, lo denuncias a GitHub.

## 🟡 6. Los datos de pacientes que tú no controlas

La app no recoge datos de pacientes por diseño y no hay servidor donde puedan acabar. Pero el feedback integrado es un `mailto` con texto libre: **un técnico puede pegar ahí lo que quiera**, incluido algo que no debería. Si te llega un correo con datos identificables de un paciente, bórralo y no lo reenvíes ni me lo pases.

## 🟡 7. El límite de Cloudflare

El plan gratuito de Workers da 100.000 peticiones al día. Tu tope global son 800 preguntas diarias, así que no te vas a acercar. Pero si algún día alguien te satura el endpoint con peticiones basura, Cloudflare simplemente empieza a devolver errores — no te factura. Es un buen sitio donde estar.

## ⚪ 8. Lo que NO debes hacer nunca, por mucho que tenga sentido

- **No añadas analítica.** Ni Google Analytics, ni Plausible, ni un contador. En el momento en que lo hagas, la frase "sin cuentas, sin anuncios, nada sale de tu móvil" se vuelve mentira, y es tu principal argumento de confianza en foros donde la gente es escéptica por oficio.
- **No pongas la clave de Anthropic en `config.js`.** Va en Cloudflare como *Secret*, y en ningún otro sitio. El repo es público y cada archivo se sirve tal cual.
- **Si la clave se filtra alguna vez:** revócala en console.anthropic.com **antes** de arreglar nada más. Con el workspace acotado, el daño ya está limitado.

---

# Resumen accionable

**Hazlo ahora, antes de publicar:**

1. 2FA en GitHub y en Cloudflare
2. Workspace `taller` en Anthropic + key acotada + tope de 5-10 $/mes
3. `RATE_KV` enlazado, y **verificado** viendo aparecer las claves `rl:...`
4. `ALLOWED_ORIGINS` con tu dominio
5. Decidir conscientemente si el email de feedback es el personal o uno dedicado

**Ten presente siempre:**

- Nunca alojar un manual
- Nunca añadir analítica
- Nunca meter la clave en el repo
- Mantenerlo no comercial mientras no hables con un abogado
