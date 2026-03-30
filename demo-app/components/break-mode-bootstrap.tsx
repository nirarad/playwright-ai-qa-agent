'use client'

import { useEffect } from 'react'
import { bootstrapBreakModeFromUrl } from '@/lib/break-mode'

export const BreakModeBootstrap = () => {
	useEffect(() => {
		bootstrapBreakModeFromUrl()
	}, [])

	return null
}

