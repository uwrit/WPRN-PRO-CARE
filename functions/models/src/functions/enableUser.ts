//
// This source file is part of the ENGAGE-HF project based on the Stanford Spezi Template Application project
//
// SPDX-FileCopyrightText: 2023 Stanford University
//
// SPDX-License-Identifier: MIT
//

import { z } from 'zod'

export const enableUserInputSchema = z.object({
  userId: z.string(),
})

export type EnableUserInput = z.input<typeof enableUserInputSchema>

export type EnableUserOutput = undefined
