/**
 * SpaceCat API Client
 *
 * Base API client for making authenticated requests to the SpaceCat API.
 * Adapted from llmo-spacecat-dashboard patterns for vanilla JavaScript usage.
 *
 * All functions accept an optional token parameter for authentication.
 * When no token is provided, requests are made without authentication headers.
 */

/**
 * Default headers for API requests
 */
const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

/**
 * Global token — set once via IMS auth so callers don't need to pass it everywhere.
 * Explicit per-call token always takes precedence.
 */
let _globalToken = null;

/**
 * Set the global bearer token used for all subsequent API requests.
 * @param {string|null} token
 */
export function setGlobalToken(token) {
  _globalToken = token;
}

/**
 * Get the current global bearer token.
 * @returns {string|null}
 */
export function getGlobalToken() {
  return _globalToken;
}

/**
 * Build headers for API request.
 * Uses the explicit token if provided, otherwise falls back to the global token.
 * @param {string|null} token - Bearer token for authentication
 * @returns {Object} Headers object
 */
function buildHeaders(token = null) {
  const effectiveToken = token || _globalToken;
  const headers = { ...DEFAULT_HEADERS };
  if (effectiveToken) {
    headers.Authorization = `Bearer ${effectiveToken}`;
  }
  return headers;
}

/**
 * Parse error response from API
 * @param {Response} response - Fetch response object
 * @returns {Promise<string>} Error message
 */
async function parseErrorMessage(response) {
  try {
    const data = await response.json();
    return data.message || data.error || `HTTP ${response.status}: ${response.statusText}`;
  } catch {
    return `HTTP ${response.status}: ${response.statusText}`;
  }
}

/**
 * Make an API request with optional authentication
 * @param {string} url - Request URL
 * @param {Object} options - Fetch options (method, body, etc.)
 * @param {string|null} token - Bearer token for authentication
 * @param {number} timeoutMs - Request timeout in milliseconds (default 30s)
 * @returns {Promise<Object|null>} Parsed JSON response or null on error
 */
export async function apiRequest(url, options = {}, token = null, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const config = {
    ...options,
    signal: controller.signal,
    headers: {
      ...buildHeaders(token),
      ...options.headers,
    },
  };

  try {
    const response = await fetch(url, config);

    if (!response.ok) {
      const errorMessage = await parseErrorMessage(response);
      console.error(`API Error [${config.method || 'GET'}] ${url}:`, errorMessage);

      // Return structured error for handling
      return {
        error: true,
        status: response.status,
        message: errorMessage,
      };
    }

    // Handle empty responses (204 No Content)
    if (response.status === 204) {
      return { success: true };
    }

    return await response.json();
  } catch (error) {
    const isTimeout = error.name === 'AbortError';
    console.error(`API Request ${isTimeout ? 'Timed out' : 'Failed'} [${config.method || 'GET'}] ${url}:`, error);
    return {
      error: true,
      status: 0,
      message: isTimeout ? `Request timed out after ${timeoutMs}ms` : (error.message || 'Network error'),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Make a GET request
 * @param {string} url - Request URL
 * @param {string|null} token - Bearer token for authentication
 * @param {number} [timeoutMs] - Optional request timeout in milliseconds
 * @returns {Promise<Object|null>} Parsed JSON response
 */
export async function apiGet(url, token = null, timeoutMs = undefined) {
  return apiRequest(url, { method: 'GET' }, token, timeoutMs);
}

/**
 * Make a POST request
 * @param {string} url - Request URL
 * @param {Object} data - Request body data
 * @param {string|null} token - Bearer token for authentication
 * @returns {Promise<Object|null>} Parsed JSON response
 */
export async function apiPost(url, data, token = null) {
  return apiRequest(
    url,
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
    token,
  );
}

/**
 * Make a PUT request
 * @param {string} url - Request URL
 * @param {Object} data - Request body data
 * @param {string|null} token - Bearer token for authentication
 * @returns {Promise<Object|null>} Parsed JSON response
 */
export async function apiPut(url, data, token = null) {
  return apiRequest(
    url,
    {
      method: 'PUT',
      body: JSON.stringify(data),
    },
    token,
  );
}

/**
 * Make a PATCH request
 * @param {string} url - Request URL
 * @param {Object} data - Request body data
 * @param {string|null} token - Bearer token for authentication
 * @returns {Promise<Object|null>} Parsed JSON response
 */
export async function apiPatch(url, data, token = null) {
  return apiRequest(
    url,
    {
      method: 'PATCH',
      body: JSON.stringify(data),
    },
    token,
  );
}

/**
 * Make a DELETE request
 * @param {string} url - Request URL
 * @param {string|null} token - Bearer token for authentication
 * @returns {Promise<Object|null>} Parsed JSON response
 */
export async function apiDelete(url, token = null) {
  return apiRequest(url, { method: 'DELETE' }, token);
}

/**
 * Exchange an IMS access token for a SpaceCat JWT.
 * SpaceCat issues its own token (aud: "spacecat-users") via POST /auth/login.
 * Sets the returned token as the global token for subsequent API calls.
 *
 * @param {string} imsAccessToken - IMS access token from imslib
 * @returns {Promise<string|null>} SpaceCat JWT, or null on failure
 */
export async function exchangeImsToken(imsAccessToken) {
  if (!imsAccessToken) return null;
  try {
    const { SPACECAT_API_BASE } = await import('../constants/api.js');
    const url = `${SPACECAT_API_BASE}/auth/login`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${imsAccessToken}`,
      },
      body: JSON.stringify({ accessToken: imsAccessToken }),
    });
    if (!response.ok) {
      console.warn('[SpaceCat] Token exchange failed:', response.status);
      return null;
    }
    const data = await response.json();
    const spacecatToken = data.token || data.accessToken || data.access_token || null;
    if (spacecatToken) {
      setGlobalToken(spacecatToken);
    }
    return spacecatToken;
  } catch (err) {
    console.error('[SpaceCat] Token exchange error:', err);
    return null;
  }
}

/**
 * Check if a response is an error
 * @param {Object} response - API response object
 * @returns {boolean} True if response indicates an error
 */
export function isApiError(response) {
  return response && response.error === true;
}

/**
 * Batch multiple API requests with concurrency control
 * @param {Array<Function>} requests - Array of functions that return promises
 * @param {number} batchSize - Number of concurrent requests
 * @param {number} delayMs - Delay between batches in milliseconds
 * @returns {Promise<Array>} Array of results
 */
export async function batchRequests(requests, batchSize = 10, delayMs = 100) {
  const results = [];
  const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < requests.length; i += batchSize) {
    const batch = requests.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((fn) => fn()));
    results.push(...batchResults);

    if (i + batchSize < requests.length && delayMs > 0) {
      await delay(delayMs);
    }
  }
  /* eslint-enable no-await-in-loop */

  return results;
}

/**
 * Build URL with query parameters
 * @param {string} baseUrl - Base URL
 * @param {Object} params - Query parameters
 * @returns {string} URL with query string
 */
export function buildUrl(baseUrl, params = {}) {
  const url = new URL(baseUrl, window.location.origin);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.append(key, String(value));
    }
  });

  return url.toString();
}
