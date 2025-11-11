/**
 * API Key Manager - Sistema de rotación automática de YouTube API Keys
 * Detecta cuando una key se queda sin cuota y rota automáticamente a la siguiente
 */

class ApiKeyManager {
  constructor() {
    // Cargar todas las API keys desde variables de entorno
    this.apiKeys = this.loadApiKeys();
    this.currentKeyIndex = 0;
    this.keyStatus = new Map(); // Estado de cada key
    
    // Inicializar estado de cada key
    this.apiKeys.forEach((key, index) => {
      this.keyStatus.set(index, {
        key: key,
        isActive: true,
        failCount: 0,
        lastError: null,
        lastUsed: null,
        quotaExceeded: false,
        resetTime: null
      });
    });

    console.log(`🔑 API Key Manager inicializado con ${this.apiKeys.length} keys`);
  }

  /**
   * Cargar API keys desde variables de entorno
   * Formato: YOUTUBE_API_KEY_1, YOUTUBE_API_KEY_2, etc.
   */
  loadApiKeys() {
    const keys = [];
    
    // Cargar key principal
    if (process.env.YOUTUBE_API_KEY) {
      keys.push(process.env.YOUTUBE_API_KEY);
    }
    
    // Cargar keys adicionales (YOUTUBE_API_KEY_1, YOUTUBE_API_KEY_2, etc.)
    let index = 1;
    while (process.env[`YOUTUBE_API_KEY_${index}`]) {
      keys.push(process.env[`YOUTUBE_API_KEY_${index}`]);
      index++;
    }
    
    if (keys.length === 0) {
      throw new Error('No se encontraron API keys de YouTube. Configura YOUTUBE_API_KEY en .env');
    }
    
    return keys;
  }

  /**
   * Obtener la API key actual
   */
  getCurrentKey() {
    const status = this.keyStatus.get(this.currentKeyIndex);
    status.lastUsed = new Date();
    return status.key;
  }

  /**
   * Obtener información de la key actual
   */
  getCurrentKeyInfo() {
    return {
      index: this.currentKeyIndex + 1,
      total: this.apiKeys.length,
      status: this.keyStatus.get(this.currentKeyIndex)
    };
  }

  /**
   * Marcar la key actual como agotada y rotar a la siguiente
   */
  markCurrentKeyAsExhausted(error) {
    const status = this.keyStatus.get(this.currentKeyIndex);
    status.quotaExceeded = true;
    status.isActive = false;
    status.lastError = error;
    status.resetTime = this.calculateResetTime();
    
    console.log(`⚠️  API Key ${this.currentKeyIndex + 1} agotada. Rotando...`);
    
    return this.rotateToNextKey();
  }

  /**
   * Marcar la key actual con error
   */
  markCurrentKeyError(error) {
    const status = this.keyStatus.get(this.currentKeyIndex);
    status.failCount++;
    status.lastError = error;
    
    // Si hay muchos errores consecutivos, marcar como inactiva
    if (status.failCount >= 3) {
      status.isActive = false;
      console.log(`❌ API Key ${this.currentKeyIndex + 1} marcada como inactiva después de ${status.failCount} fallos`);
      return this.rotateToNextKey();
    }
    
    return status.key;
  }

  /**
   * Resetear contador de errores de la key actual (después de request exitoso)
   */
  resetCurrentKeyErrors() {
    const status = this.keyStatus.get(this.currentKeyIndex);
    status.failCount = 0;
    status.lastError = null;
  }

  /**
   * Rotar a la siguiente key disponible
   */
  rotateToNextKey() {
    const startIndex = this.currentKeyIndex;
    let attempts = 0;
    
    do {
      this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
      attempts++;
      
      const status = this.keyStatus.get(this.currentKeyIndex);
      
      // Si encontramos una key activa, usarla
      if (status.isActive && !status.quotaExceeded) {
        console.log(`✅ Rotado a API Key ${this.currentKeyIndex + 1}`);
        return status.key;
      }
      
      // Si la key tiene quota exceeded pero pasó tiempo suficiente, reactivarla
      if (status.quotaExceeded && this.shouldResetKey(status)) {
        status.quotaExceeded = false;
        status.isActive = true;
        status.failCount = 0;
        console.log(`🔄 API Key ${this.currentKeyIndex + 1} reactivada (reset de cuota)`);
        return status.key;
      }
      
    } while (this.currentKeyIndex !== startIndex && attempts < this.apiKeys.length);
    
    // Si todas las keys están agotadas
    throw new Error('Todas las API keys están agotadas. Intenta nuevamente más tarde.');
  }

  /**
   * Verificar si una key debería ser reseteada (han pasado 24h)
   */
  shouldResetKey(status) {
    if (!status.resetTime) return false;
    return new Date() >= status.resetTime;
  }

  /**
   * Calcular hora de reset (medianoche PST = siguiente día a las 00:00 PST)
   */
  calculateResetTime() {
    const now = new Date();
    const resetTime = new Date(now);
    
    // YouTube cuota se resetea a medianoche PST (UTC-8)
    // Convertir a PST y avanzar al siguiente día
    resetTime.setUTCHours(8, 0, 0, 0); // Medianoche PST en UTC
    
    // Si ya pasó la hora de reset hoy, establecer para mañana
    if (now >= resetTime) {
      resetTime.setDate(resetTime.getDate() + 1);
    }
    
    return resetTime;
  }

  /**
   * Verificar si el error es de cuota excedida
   */
  isQuotaError(error) {
    const errorMessage = error.response?.data?.error?.message || error.message || '';
    const errorCode = error.response?.data?.error?.code;
    
    return (
      errorCode === 403 ||
      errorMessage.toLowerCase().includes('quota') ||
      errorMessage.toLowerCase().includes('exceeded') ||
      errorMessage.toLowerCase().includes('limit')
    );
  }

  /**
   * Verificar si el error es de API key inválida
   */
  isInvalidKeyError(error) {
    const errorMessage = error.response?.data?.error?.message || error.message || '';
    
    return (
      errorMessage.toLowerCase().includes('api key') ||
      errorMessage.toLowerCase().includes('invalid') ||
      errorMessage.toLowerCase().includes('unregistered')
    );
  }

  /**
   * Manejar error de API y decidir si rotar
   */
  handleApiError(error) {
    if (this.isQuotaError(error)) {
      console.log('🔄 Cuota excedida detectada, rotando API key...');
      return this.markCurrentKeyAsExhausted(error.message);
    } else if (this.isInvalidKeyError(error)) {
      console.log('❌ API Key inválida, rotando...');
      return this.markCurrentKeyError(error.message);
    } else {
      // Error no relacionado con la key, no rotar
      return this.getCurrentKey();
    }
  }

  /**
   * Obtener estado de todas las keys
   */
  getAllKeysStatus() {
    const status = [];
    this.keyStatus.forEach((value, index) => {
      status.push({
        keyNumber: index + 1,
        isActive: value.isActive,
        quotaExceeded: value.quotaExceeded,
        failCount: value.failCount,
        lastUsed: value.lastUsed,
        lastError: value.lastError,
        resetTime: value.resetTime,
        isCurrent: index === this.currentKeyIndex
      });
    });
    return status;
  }

  /**
   * Forzar reset manual de una key específica
   */
  resetKey(keyIndex) {
    if (keyIndex < 0 || keyIndex >= this.apiKeys.length) {
      throw new Error('Índice de key inválido');
    }
    
    const status = this.keyStatus.get(keyIndex);
    status.isActive = true;
    status.quotaExceeded = false;
    status.failCount = 0;
    status.lastError = null;
    status.resetTime = null;
    
    console.log(`🔄 API Key ${keyIndex + 1} reseteada manualmente`);
  }

  /**
   * Resetear todas las keys
   */
  resetAllKeys() {
    this.keyStatus.forEach((status, index) => {
      status.isActive = true;
      status.quotaExceeded = false;
      status.failCount = 0;
      status.lastError = null;
      status.resetTime = null;
    });
    console.log('🔄 Todas las API keys reseteadas');
  }
}

// Singleton instance - lazy loading para que dotenv se cargue primero
let apiKeyManagerInstance = null;

export function getApiKeyManager() {
  if (!apiKeyManagerInstance) {
    apiKeyManagerInstance = new ApiKeyManager();
  }
  return apiKeyManagerInstance;
}

// Para compatibilidad, exportar default también
export default {
  getInstance: getApiKeyManager
};
