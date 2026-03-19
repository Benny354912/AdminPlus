/* Crypto Utils für Easy Login */
const CryptoUtils = (() => {
  const PROTECTION_KEY = 'easylogin_protection';
  const HASH_KEY = 'easylogin_hash';
  const SALT_KEY = 'easylogin_salt';

  /**
   * Hasht einen String mit SHA-256
   */
  async function hashValue(value, salt = '') {
    const encoder = new TextEncoder();
    const data = encoder.encode(value + salt);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Generiert einen zufälligen Salt
   */
  function generateSalt() {
    return crypto.getRandomValues(new Uint8Array(16))
      .reduce((hex, byte) => hex + ('0' + byte.toString(16)).slice(-2), '');
  }

  /**
   * Speichert die Schutz-Einstellung
   */
  async function setProtection(type, value) {
    const salt = generateSalt();
    const hash = await hashValue(value, salt);

    localStorage.setItem(PROTECTION_KEY, type);
    localStorage.setItem(HASH_KEY, hash);
    localStorage.setItem(SALT_KEY, salt);
  }

  /**
   * Gibt den aktuellen Schutz-Typ zurück
   */
  function getProtectionType() {
    return localStorage.getItem(PROTECTION_KEY) || 'none';
  }

  /**
   * Verarbeitet ein PIN/Passwort/Muster und gibt wahr zurück wenn korrekt
   */
  async function verifyProtection(value) {
    const protectionType = getProtectionType();

    if (protectionType === 'none') {
      return true;
    }

    const storedHash = localStorage.getItem(HASH_KEY);
    const storedSalt = localStorage.getItem(SALT_KEY);

    if (!storedHash || !storedSalt) {
      return false;
    }

    const hash = await hashValue(value, storedSalt);
    return hash === storedHash;
  }

  /**
   * Löscht alle Schutz-Informationen (beim Zurücksetzen)
   */
  function clearProtection() {
    localStorage.removeItem(PROTECTION_KEY);
    localStorage.removeItem(HASH_KEY);
    localStorage.removeItem(SALT_KEY);
  }

  /**
   * Gibt zurück ob Schutz eingestellt ist
   */
  function isProtected() {
    return getProtectionType() !== 'none';
  }

  // Pattern-Handling für Muster
  const PatternLock = (() => {
    const PATTERN_POINTS = 9;
    const GRID_SIZE = 3;
    let selectedPoints = [];

    function createPatternCanvas(containerId) {
      const container = document.getElementById(containerId);
      if (!container) return;

      container.innerHTML = '';
      const canvas = document.createElement('canvas');
      canvas.width = 300;
      canvas.height = 300;
      canvas.className = 'pattern-grid';
      container.appendChild(canvas);

      const ctx = canvas.getContext('2d');
      const pointRadius = 20;
      const spacing = 100;

      // Zeichne Grid
      for (let i = 0; i < GRID_SIZE; i++) {
        for (let j = 0; j < GRID_SIZE; j++) {
          const x = 50 + j * spacing;
          const y = 50 + i * spacing;
          ctx.fillStyle = '#e5e7eb';
          ctx.fillRect(x - 25, y - 25, 50, 50);
          ctx.fillStyle = '#d1d5db';
          ctx.beginPath();
          ctx.arc(x, y, pointRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Touch-Handler
      canvas.addEventListener('touchstart', (e) => handlePatternInput(e, canvas, spacing));
      canvas.addEventListener('touchmove', (e) => handlePatternInput(e, canvas, spacing));
      canvas.addEventListener('touchend', (e) => endPattern(e));

      return canvas;
    }

    function handlePatternInput(e, canvas, spacing) {
      if (e.touches.length === 0) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.touches[0].clientX - rect.left;
      const y = e.touches[0].clientY - rect.top;

      const point = getPointAtCoords(x, y, spacing);
      if (point !== null && !selectedPoints.includes(point)) {
        selectedPoints.push(point);
        redrawPattern(canvas, spacing);
      }
    }

    function endPattern(e) {
      e.preventDefault();
    }

    function getPointAtCoords(x, y, spacing) {
      for (let i = 0; i < GRID_SIZE; i++) {
        for (let j = 0; j < GRID_SIZE; j++) {
          const px = 50 + j * spacing;
          const py = 50 + i * spacing;
          const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
          if (dist < 40) {
            return i * GRID_SIZE + j;
          }
        }
      }
      return null;
    }

    function redrawPattern(canvas, spacing) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Zeichne Grid
      for (let i = 0; i < GRID_SIZE; i++) {
        for (let j = 0; j < GRID_SIZE; j++) {
          const x = 50 + j * spacing;
          const y = 50 + i * spacing;
          const idx = i * GRID_SIZE + j;
          const isSelected = selectedPoints.includes(idx);

          ctx.fillStyle = isSelected ? '#1e88e5' : '#e5e7eb';
          ctx.fillRect(x - 25, y - 25, 50, 50);
          ctx.fillStyle = isSelected ? '#1565c0' : '#d1d5db';
          ctx.beginPath();
          ctx.arc(x, y, 20, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Zeichne Linien
      ctx.strokeStyle = '#1e88e5';
      ctx.lineWidth = 3;
      selectedPoints.forEach((point, idx) => {
        const i = Math.floor(point / GRID_SIZE);
        const j = point % GRID_SIZE;
        const x = 50 + j * spacing;
        const y = 50 + i * spacing;
        if (idx === 0) {
          ctx.beginPath();
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    }

    function getPattern() {
      return selectedPoints.join('');
    }

    function resetPattern() {
      selectedPoints = [];
    }

    return {
      createPatternCanvas,
      getPattern,
      resetPattern,
      PATTERN_POINTS
    };
  })();

  // ===== Public/Private Key Encryption =====
  const EncryptionUtils = (() => {
    /**
     * Generiert ein neues Public/Private Key Paar (RSA-OAEP)
     */
    async function generateKeyPair() {
      try {
        const keyPair = await crypto.subtle.generateKey(
          {
            name: 'RSA-OAEP',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]), // 65537
            hash: 'SHA-256'
          },
          true, // extractable
          ['encrypt', 'decrypt']
        );
        return keyPair;
      } catch (error) {
        console.error('Fehler beim Generieren des Key Paares:', error);
        return null;
      }
    }

    /**
     * Exportiert einen Public Key in JWK Format
     */
    async function exportPublicKey(publicKey) {
      try {
        const jwk = await crypto.subtle.exportKey('jwk', publicKey);
        return JSON.stringify(jwk);
      } catch (error) {
        console.error('Fehler beim Exportieren des Public Keys:', error);
        return null;
      }
    }

    /**
     * Importiert einen Public Key aus JWK Format
     */
    async function importPublicKey(jwkString) {
      try {
        const jwk = JSON.parse(jwkString);
        const publicKey = await crypto.subtle.importKey(
          'jwk',
          jwk,
          {
            name: 'RSA-OAEP',
            hash: 'SHA-256'
          },
          true,
          ['encrypt']
        );
        return publicKey;
      } catch (error) {
        console.error('Fehler beim Importieren des Public Keys:', error);
        return null;
      }
    }

    /**
     * Verschlüsselt einen Text mit einem Public Key (Hybrid: AES + RSA)
     * Verwendet AES-GCM für die Daten und RSA-OAEP für den AES-Schlüssel
     */
    async function encryptWithPublicKey(publicKey, text) {
      try {
        // 1. Generiere einen zufälligen AES-Schlüssel
        const aesKey = await crypto.subtle.generateKey(
          { name: 'AES-GCM', length: 256 },
          true,
          ['encrypt', 'decrypt']
        );
        
        // 2. Generiere einen zufälligen IV für AES
        const iv = crypto.getRandomValues(new Uint8Array(12));
        
        // 3. Verschlüssele die Daten mit AES-GCM
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const encryptedData = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: iv },
          aesKey,
          data
        );
        
        // 4. Exportiere den AES-Schlüssel als Raw-Format
        const aesKeyRaw = await crypto.subtle.exportKey('raw', aesKey);
        
        // 5. Verschlüssele den AES-Schlüssel mit RSA
        const encryptedAesKey = await crypto.subtle.encrypt(
          'RSA-OAEP',
          publicKey,
          aesKeyRaw
        );
        
        // 6. Kombiniere alles: verschlüsselter AES-Schlüssel + IV + verschlüsselte Daten
        const result = {
          encryptedKey: btoa(String.fromCharCode(...new Uint8Array(encryptedAesKey))),
          iv: btoa(String.fromCharCode(...iv)),
          data: btoa(String.fromCharCode(...new Uint8Array(encryptedData)))
        };
        
        return JSON.stringify(result);
      } catch (error) {
        console.error('Fehler beim Verschlüsseln:', error);
        return null;
      }
    }

    /**
     * Entschlüsselt einen Text mit einem Private Key (Hybrid: AES + RSA)
     * Erwartet ein JSON-Objekt mit encryptedKey, iv und data
     */
    async function decryptWithPrivateKey(privateKey, encryptedBase64) {
      try {
        // Parse das verschlüsselte Objekt
        let encryptedObj;
        try {
          encryptedObj = JSON.parse(encryptedBase64);
        } catch {
          // Fallback für altes Format (direkt RSA-verschlüsselt)
          try {
            const encryptedData = Uint8Array.from(
              atob(encryptedBase64),
              c => c.charCodeAt(0)
            );
            const decryptedBuffer = await crypto.subtle.decrypt(
              'RSA-OAEP',
              privateKey,
              encryptedData
            );
            const decoder = new TextDecoder();
            return decoder.decode(decryptedBuffer);
          } catch (legacyError) {
            console.error('Fehler beim Entschlüsseln (Legacy-Format):', legacyError);
            return null;
          }
        }
        
        // Neues Hybrid-Format
        // 1. Konvertiere die Base64-Strings zurück zu Uint8Arrays
        const encryptedKey = Uint8Array.from(
          atob(encryptedObj.encryptedKey),
          c => c.charCodeAt(0)
        );
        const iv = Uint8Array.from(
          atob(encryptedObj.iv),
          c => c.charCodeAt(0)
        );
        const encryptedData = Uint8Array.from(
          atob(encryptedObj.data),
          c => c.charCodeAt(0)
        );
        
        // 2. Entschlüssele den AES-Schlüssel mit RSA
        const aesKeyRaw = await crypto.subtle.decrypt(
          'RSA-OAEP',
          privateKey,
          encryptedKey
        );
        
        // 3. Importiere den AES-Schlüssel
        const aesKey = await crypto.subtle.importKey(
          'raw',
          aesKeyRaw,
          { name: 'AES-GCM', length: 256 },
          false,
          ['decrypt']
        );
        
        // 4. Entschlüssele die Daten mit AES-GCM
        const decryptedBuffer = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv },
          aesKey,
          encryptedData
        );
        
        const decoder = new TextDecoder();
        return decoder.decode(decryptedBuffer);
      } catch (error) {
        console.error('Fehler beim Entschlüsseln:', error);
        return null;
      }
    }

    /**
     * Verschlüsselt ein Objekt mit einem Public Key
     */
    async function encryptObject(publicKey, obj) {
      const jsonString = JSON.stringify(obj);
      return await encryptWithPublicKey(publicKey, jsonString);
    }

    /**
     * Entschlüsselt ein Objekt mit einem Private Key
     */
    async function decryptObject(privateKey, encryptedBase64) {
      const decrypted = await decryptWithPrivateKey(privateKey, encryptedBase64);
      if (!decrypted) return null;
      try {
        return JSON.parse(decrypted);
      } catch (error) {
        console.error('Fehler beim Parsen des entschlüsselten Objekts:', error);
        return null;
      }
    }

    return {
      generateKeyPair,
      exportPublicKey,
      importPublicKey,
      encryptWithPublicKey,
      decryptWithPrivateKey,
      encryptObject,
      decryptObject
    };
  })();

  return {
    hashValue,
    generateSalt,
    setProtection,
    getProtectionType,
    verifyProtection,
    clearProtection,
    isProtected,
    PatternLock,
    EncryptionUtils
  };
})();
