const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');

/**
 * Módulo de observación de archivos
 * 
 * Este módulo encapsula toda la funcionalidad de vigilancia de archivos
 * utilizando Chokidar para proporcionar una gestión de ciclo de vida confiable
 * sin fugas de memoria.
 */

// Almacena la instancia actual del observador
let currentWatcher = null;

/**
 * Inicia el observador de archivos para el directorio especificado.
 * @param {string} directoryPath Ruta absoluta al directorio a observar.
 * @param {Array<string>} ignoredPatterns Patrones glob para ignorar.
 * @param {Object} handlers Objeto con manejadores de eventos.
 * @param {function(string): void} handlers.onAdd Manejador para evento 'add'.
 * @param {function(string): void} handlers.onChange Manejador para evento 'change'.
 * @param {function(string): void} handlers.onUnlink Manejador para evento 'unlink'.
 * @param {function(Error): void} handlers.onError Manejador para evento 'error'.
 * @param {function(): void} handlers.onReady Manejador para evento 'ready'.
 * @returns {Promise<void>} Una promesa que se resuelve cuando el observador está listo.
 */
function startWatcher(directoryPath, ignoredPatterns, handlers) {
  return new Promise((resolve) => {
    // Detener cualquier observador existente primero
    stopWatcher().then(() => {
      console.log(`Iniciando observador para directorio: ${directoryPath}`);
      
      const watcherConfig = {
        ignored: ignoredPatterns,
        persistent: true,
        ignoreInitial: true, // No dispara eventos 'add' para archivos existentes al inicio
        awaitWriteFinish: { // Ayuda a prevenir eventos duplicados en cambios rápidos
          stabilityThreshold: 2000,
          pollInterval: 100
        },
        depth: Infinity, // Observa subdirectorios recursivamente
        usePolling: false, // Usa fsevents/inotify nativos si están disponibles
      };

      currentWatcher = chokidar.watch(directoryPath, watcherConfig);

      // Configurar manejadores de eventos
      currentWatcher
        .on('add', filePath => {
          console.log(`Observador: Archivo añadido - ${filePath}`);
          if (handlers && handlers.onAdd) handlers.onAdd(filePath);
        })
        .on('change', filePath => {
          console.log(`Observador: Archivo modificado - ${filePath}`);
          if (handlers && handlers.onChange) handlers.onChange(filePath);
        })
        .on('unlink', filePath => {
          console.log(`Observador: Archivo eliminado - ${filePath}`);
          if (handlers && handlers.onUnlink) handlers.onUnlink(filePath);
        })
        .on('error', error => {
          console.error(`Error del observador: ${error}`);
          if (handlers && handlers.onError) handlers.onError(error);
        })
        .on('ready', () => {
          console.log('Escaneo inicial completo. Listo para los cambios.');
          if (handlers && handlers.onReady) handlers.onReady();
          resolve(); // Resolver la promesa cuando el observador esté listo
        });
    });
  });
}

/**
 * Detiene el observador de archivos actual.
 * @returns {Promise<void>} Una promesa que se resuelve cuando el observador se cierra.
 */
async function stopWatcher() {
  if (currentWatcher) {
    console.log('Deteniendo observador existente...');
    try {
      await currentWatcher.close();
      console.log('Observador detenido correctamente.');
    } catch (error) {
      console.error('Error al detener el observador:', error);
    }
    currentWatcher = null;
  }
  return Promise.resolve();
}

/**
 * Actualiza los patrones ignorados sin reiniciar todo el observador.
 * @param {function(string): boolean} ignoreFunction Función que decide si ignorar una ruta.
 * @returns {Promise<void>}
 */
async function updateIgnoreFunction(ignoreFunction) {
  if (!currentWatcher) {
    console.warn('No hay observador activo para actualizar la función de ignorar.');
    return;
  }
  
  try {
    // En Chokidar, no podemos cambiar la función 'ignored' directamente
    // La mejor forma es reiniciar el observador con la nueva configuración
    const watchedPaths = currentWatcher.getWatched();
    const allWatchedDirs = Object.keys(watchedPaths);
    
    if (allWatchedDirs.length > 0) {
      const mainDir = allWatchedDirs[0]; // Normalmente el directorio raíz
      
      // Obtener los manejadores actuales (esto es una simplificación)
      const currentHandlers = extractCurrentHandlers();
      
      // Reiniciar con la nueva función de ignorar
      await stopWatcher();
      
      // Crear nueva configuración con la nueva función de ignorar
      const newConfig = {
        ignored: ignoreFunction,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 2000,
          pollInterval: 100
        },
        depth: Infinity,
        usePolling: false,
      };
      
      // Iniciar con la nueva configuración
      currentWatcher = chokidar.watch(mainDir, newConfig);
      
      // Reconectar los manejadores
      reattachHandlers(currentHandlers);
      
      console.log('Función de ignorar actualizada correctamente.');
    } else {
      console.warn('No se pudieron determinar los directorios observados para actualizar.');
    }
  } catch (error) {
    console.error('Error al actualizar la función de ignorar:', error);
  }
}

/**
 * Extrae los manejadores actuales del observador.
 * Nota: Esta es una función de ayuda para updateIgnoreFunction.
 * @private
 * @returns {Object} Objeto con los manejadores actuales.
 */
function extractCurrentHandlers() {
  // Esta es una simplificación. En la implementación real,
  // necesitaríamos una manera de extraer los manejadores del observador actual.
  // Chokidar no proporciona una API directa para esto.
  return {
    onAdd: currentWatcher.listenerCount('add') > 0 ? 
      currentWatcher.listeners('add')[0] : null,
    onChange: currentWatcher.listenerCount('change') > 0 ?
      currentWatcher.listeners('change')[0] : null,
    onUnlink: currentWatcher.listenerCount('unlink') > 0 ?
      currentWatcher.listeners('unlink')[0] : null,
    onError: currentWatcher.listenerCount('error') > 0 ?
      currentWatcher.listeners('error')[0] : null,
    onReady: currentWatcher.listenerCount('ready') > 0 ?
      currentWatcher.listeners('ready')[0] : null,
  };
}

/**
 * Reconecta los manejadores al observador.
 * Nota: Esta es una función de ayuda para updateIgnoreFunction.
 * @private
 * @param {Object} handlers Objeto con los manejadores a reconectar.
 */
function reattachHandlers(handlers) {
  if (!currentWatcher) return;
  
  if (handlers.onAdd) currentWatcher.on('add', handlers.onAdd);
  if (handlers.onChange) currentWatcher.on('change', handlers.onChange);
  if (handlers.onUnlink) currentWatcher.on('unlink', handlers.onUnlink);
  if (handlers.onError) currentWatcher.on('error', handlers.onError);
  if (handlers.onReady) currentWatcher.on('ready', handlers.onReady);
}

/**
 * Verifica si el observador está actualmente activo.
 * @returns {boolean} true si hay un observador activo.
 */
function isWatching() {
  return currentWatcher !== null;
}

/**
 * Obtiene las rutas que actualmente están siendo observadas.
 * @returns {Object|null} Un objeto con las rutas observadas o null si no hay observador.
 */
function getWatchedPaths() {
  return currentWatcher ? currentWatcher.getWatched() : null;
}

module.exports = {
  startWatcher,
  stopWatcher,
  updateIgnoreFunction,
  isWatching,
  getWatchedPaths,
};