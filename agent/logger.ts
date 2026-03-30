type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const getLogLevel = (): LogLevel => {
  const envLevel = (process.env.AGENT_LOG_LEVEL ?? 'info').toLowerCase()
  if (envLevel === 'debug' || envLevel === 'info' || envLevel === 'warn' || envLevel === 'error') {
    return envLevel
  }
  return 'info'
}

const shouldLog = (level: LogLevel): boolean => {
  return levelOrder[level] >= levelOrder[getLogLevel()]
}

const isPretty = (): boolean => {
  return process.env.AGENT_LOG_PRETTY === 'true'
}

const formatData = (data: unknown): string => {
  if (!data) {
    return ''
  }

  if (typeof data !== 'object') {
    return String(data)
  }

  const entries = Object.entries(data as Record<string, unknown>)
  if (entries.length === 0) {
    return ''
  }

  return entries
    .map(([key, value]) => {
      if (typeof value === 'string') {
        return `${key}="${value}"`
      }
      return `${key}=${JSON.stringify(value)}`
    })
    .join(' ')
}

const write = (level: LogLevel, message: string, data?: unknown): void => {
  if (!shouldLog(level)) {
    return
  }

  const timestamp = new Date().toISOString()
  const context = formatData(data)
  const line = isPretty()
    ? `[${timestamp}] ${level.toUpperCase()} ${message}${context ? `\n  ${context}` : ''}`
    : `[${timestamp}] ${level.toUpperCase()} ${message}${context ? ` ${context}` : ''}`

  if (level === 'warn' || level === 'error') {
    console.error(line)
    return
  }
  console.log(line)
}

export const logger = {
  debug: (message: string, data?: unknown) => write('debug', message, data),
  info: (message: string, data?: unknown) => write('info', message, data),
  warn: (message: string, data?: unknown) => write('warn', message, data),
  error: (message: string, data?: unknown) => write('error', message, data),
}

