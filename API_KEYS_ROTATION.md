# Sistema de Rotación Automática de API Keys

## 🔑 ¿Qué es esto?

Este sistema administra múltiples API keys de YouTube y rota automáticamente entre ellas cuando una se queda sin cuota.

## 📋 Características

- ✅ **Rotación automática** cuando se agota la cuota
- ✅ **Detección inteligente** de errores de cuota
- ✅ **Reinicio automático** después de 24 horas
- ✅ **Monitoreo en tiempo real** del estado de cada key
- ✅ **Caché de requests** para reducir consumo
- ✅ **Fallback automático** si una key falla

## 🚀 Configuración

### 1. Agregar API Keys en `.env`

```bash
# Key principal (requerida)
YOUTUBE_API_KEY=AIzaSyABCDEF123456789

# Keys adicionales (opcional)
YOUTUBE_API_KEY_1=AIzaSyGHIJKL987654321
YOUTUBE_API_KEY_2=AIzaSyMNOPQR123456789
YOUTUBE_API_KEY_3=AIzaSyXYZ123456789
```

### 2. El sistema detectará automáticamente todas las keys

El sistema cargará:
- `YOUTUBE_API_KEY` (key principal)
- `YOUTUBE_API_KEY_1`, `YOUTUBE_API_KEY_2`, etc. (keys adicionales)

## 📊 Endpoints de Monitoreo

### Obtener estado de todas las keys

```bash
GET http://localhost:3001/api/youtube/keys/status
```

**Respuesta:**
```json
{
  "currentKey": {
    "index": 1,
    "total": 3,
    "status": {
      "key": "AIza....",
      "isActive": true,
      "quotaExceeded": false,
      "failCount": 0,
      "lastUsed": "2025-11-07T..."
    }
  },
  "allKeys": [
    {
      "keyNumber": 1,
      "isActive": true,
      "quotaExceeded": false,
      "isCurrent": true
    },
    {
      "keyNumber": 2,
      "isActive": true,
      "quotaExceeded": false,
      "isCurrent": false
    }
  ]
}
```

### Resetear una key específica

```bash
POST http://localhost:3001/api/youtube/keys/reset/1
```

### Resetear todas las keys

```bash
POST http://localhost:3001/api/youtube/keys/reset-all
```

## 🔄 Flujo de Rotación

1. **Request normal** → Usa key actual
2. **Error de cuota** → Marca key como agotada
3. **Rotación automática** → Cambia a siguiente key disponible
4. **Continúa operando** → Sin interrupciones para el usuario
5. **Reset después de 24h** → Keys se reactivan automáticamente

## 💡 Límites de YouTube API

- **Cuota diaria**: 10,000 unidades por key
- **Reset de cuota**: Medianoche PST (UTC-8)
- **Consumo típico**:
  - Búsqueda simple: 100 unidades
  - Búsqueda con detalles: 200 unidades
  - Detalles de canal: 1-3 unidades

## 📈 Estimación de Requests

Con **1 API key** (10,000 unidades/día):
- ~50 búsquedas completas
- ~100 páginas de artistas

Con **3 API keys** (30,000 unidades/día):
- ~150 búsquedas completas
- ~300 páginas de artistas

Con **5 API keys** (50,000 unidades/día):
- ~250 búsquedas completas
- ~500 páginas de artistas

## 🛠️ Logs del Sistema

El sistema muestra logs detallados:

```
🔑 API Key Manager inicializado con 3 keys
✅ Rotado a API Key 2
⚠️  API Key 1 agotada. Rotando...
🔄 API Key 1 reactivada (reset de cuota)
```

## 🔧 Solución de Problemas

### Todas las keys están agotadas

**Error:**
```
Todas las API keys están agotadas. Intenta nuevamente más tarde.
```

**Solución:**
1. Esperar hasta medianoche PST
2. Agregar más API keys
3. Usar el caché más agresivamente

### Key inválida

**Error:**
```
API Key no configurada correctamente
```

**Solución:**
1. Verificar que las keys estén correctamente en `.env`
2. Asegurar que YouTube Data API v3 esté habilitada
3. Verificar que no haya espacios en las keys

## 📝 Notas Importantes

1. **Caché**: El sistema cachea requests por 1 hora para reducir consumo
2. **Fallback**: Si una key falla 3 veces consecutivas, se marca como inactiva
3. **Reset automático**: Las keys se resetean automáticamente a medianoche PST
4. **Monitoreo**: Usa `/keys/status` para ver el estado en tiempo real

## 🎯 Mejores Prácticas

1. **Usar al menos 3 API keys** para mejor disponibilidad
2. **Monitorear el estado** regularmente
3. **Implementar caché** en el frontend también
4. **Limitar requests** innecesarios
5. **Rotar proyectos** en Google Cloud si es necesario
