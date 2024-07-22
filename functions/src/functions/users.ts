//
// This source file is part of the ENGAGE-HF project based on the Stanford Spezi Template Application project
//
// SPDX-FileCopyrightText: 2023 Stanford University
//
// SPDX-License-Identifier: MIT
//

import admin from 'firebase-admin'
import { https } from 'firebase-functions'
import { type CallableRequest, onCall } from 'firebase-functions/v2/https'
import { type Result } from './types.js'
import { type UserAuthenticationInformation } from '../models/invitation.js'
import {
  type Admin,
  type Clinician,
  type Patient,
  type User,
} from '../models/user.js'
import { FirestoreService } from '../services/database/firestoreService.js'
import { SecurityService } from '../services/securityService.js'

export interface GetUsersInformationInput {
  includeClinicianData?: boolean
  includePatientData?: boolean
  includeUserData?: boolean
  userIds?: string[]
}

export interface UserInformation {
  auth: UserAuthenticationInformation
  clinician?: Clinician
  patient?: Patient
  user?: User
}

export type GetUsersInformationOutput = Record<string, Result<UserInformation>>

export const getUsersInformationFunction = onCall(
  async (request: CallableRequest<GetUsersInformationInput>) => {
    if (!request.auth?.uid)
      throw new https.HttpsError('unauthenticated', 'User is not authenticated')

    if (!request.data.userIds)
      throw new https.HttpsError('invalid-argument', 'User IDs are required')

    if (request.data.userIds.length > 100)
      throw new https.HttpsError('invalid-argument', 'Too many user IDs')

    const firestoreService = new FirestoreService()
    const authenticatedUser = await firestoreService.getUser(request.auth.uid)
    const organization = authenticatedUser.content?.organization

    const securityService = new SecurityService()
    await securityService.ensureClinician(request.auth, organization)

    const result: GetUsersInformationOutput = {}
    for (const userId of request.data.userIds) {
      try {
        const userData = await firestoreService.getUser(userId)
        // organization is undefined for admins
        if (organization && userData.content?.organization !== organization)
          throw new https.HttpsError(
            'permission-denied',
            'User does not belong to the same organization',
          )
        const user = await firestoreService.getUserRecord(userId)
        const userInformation: UserInformation = {
          auth: {
            displayName: user.displayName,
            email: user.email,
            phoneNumber: user.phoneNumber,
            photoURL: user.photoURL,
          },
        }
        if (request.data.includeClinicianData ?? false) {
          const clinician = await firestoreService.getClinician(userId)
          userInformation.clinician = clinician.content
        }
        if (request.data.includePatientData ?? false) {
          const patient = await firestoreService.getPatient(userId)
          userInformation.patient = patient.content
        }
        if (request.data.includeUserData ?? false) {
          userInformation.user = userData.content
        }
        result[userId] = { data: userInformation }
      } catch (error) {
        if (error instanceof https.HttpsError) {
          result[userId] = {
            error: {
              code: error.code,
              message: error.message,
            },
          }
        } else if (error instanceof Error) {
          result[userId] = {
            error: {
              code: '500',
              message: error.message,
            },
          }
        } else {
          result[userId] = {
            error: {
              code: '500',
              message: 'Internal server error',
            },
          }
        }
      }
    }
    return result
  },
)

export interface UpdateUserInformationInput {
  userId?: string
  data?: UserInformation
}

export const updateUserInformationFunction = onCall(
  async (request: CallableRequest<UpdateUserInformationInput>) => {
    if (!request.auth?.uid)
      throw new https.HttpsError('unauthenticated', 'User is not authenticated')

    if (!request.data.userId)
      throw new https.HttpsError('invalid-argument', 'User ID is required')

    if (!request.data.data)
      throw new https.HttpsError('invalid-argument', 'User data is required')

    const firestoreService = new FirestoreService()
    const user = await firestoreService.getUser(request.data.userId)
    const organization = user.content?.organization

    const securityService = new SecurityService()
    try {
      await securityService.ensureClinician(request.auth, organization)
    } catch {
      securityService.ensureUser(request.auth, request.data.userId)
    }

    const auth = admin.auth()
    await auth.updateUser(request.data.userId, {
      displayName: request.data.data.auth.displayName,
      email: request.data.data.auth.email,
      phoneNumber: request.data.data.auth.phoneNumber,
      photoURL: request.data.data.auth.photoURL,
    })
  },
)

export interface DeleteUserInput {
  userId?: string
}

export const deleteUserFunction = onCall(
  async (request: CallableRequest<DeleteUserInput>) => {
    if (!request.auth?.uid)
      throw new https.HttpsError('unauthenticated', 'User is not authenticated')

    if (!request.data.userId)
      throw new https.HttpsError('invalid-argument', 'User ID is required')

    const firestoreService = new FirestoreService()
    const user = await firestoreService.getUser(request.auth.uid)

    const securityService = new SecurityService()
    await securityService.ensureClinician(
      request.auth,
      user.content?.organization,
    )

    const firestore = admin.firestore()
    await firestore.recursiveDelete(
      firestore.doc(`admins/${request.data.userId}`),
    )
    await firestore.recursiveDelete(
      firestore.doc(`clinicians/${request.data.userId}`),
    )
    await firestore.recursiveDelete(
      firestore.doc(`patients/${request.data.userId}`),
    )
    await firestore.recursiveDelete(
      firestore.doc(`users/${request.data.userId}`),
    )
    const auth = admin.auth()
    await auth.deleteUser(request.data.userId)
    return 'Success'
  },
)

export interface CreateInvitationInput {
  auth?: UserAuthenticationInformation
  admin?: Admin
  clinician?: Clinician
  patient?: Patient
  user?: User
}

export interface CreateInvitationOutput {
  code: string
}

export const createInvitationFunction = onCall(
  async (request: CallableRequest<CreateInvitationInput>) => {
    if (!request.auth?.uid)
      throw new https.HttpsError('unauthenticated', 'User is not authenticated')

    if (!request.data.auth)
      throw new https.HttpsError(
        'invalid-argument',
        'User authentication data is required',
      )

    if (!request.data.user)
      throw new https.HttpsError('invalid-argument', 'User data is required')

    const securityService = new SecurityService()
    if (request.data.admin !== undefined)
      await securityService.ensureAdmin(request.auth)
    else
      await securityService.ensureOwner(
        request.auth,
        request.data.user.organization,
      )

    const firestore = admin.firestore()
    const invitationCollection = firestore.collection('invitations')
    const invitationCode =
      request.data.clinician !== undefined || request.data.admin !== undefined ?
        request.data.auth.email
      : undefined

    if (invitationCode) {
      const invitationDoc = invitationCollection.doc(invitationCode)
      await invitationDoc.create(request.data)
      return { code: invitationDoc.id }
    } else {
      for (let counter = 0; ; counter++) {
        const invitationCode = generateInvitationCode(8)
        const invitationDoc = invitationCollection.doc(invitationCode)
        try {
          await invitationDoc.create(request.data)
          return { code: invitationDoc.id }
        } catch (error) {
          if (counter < 4) continue
          throw error
        }
      }
    }
  },
)

function generateInvitationCode(length: number): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const charactersLength = characters.length
  let result = ''
  for (let counter = 0; counter < length; counter++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength))
  }
  return result
}

export interface GrantOwnerInput {
  userId?: string
  organizationId?: string
}

export const grantOwnerFunction = onCall(
  async (request: CallableRequest<GrantOwnerInput>) => {
    if (!request.data.userId)
      throw new https.HttpsError('invalid-argument', 'User ID is required')
    if (!request.data.organizationId)
      throw new https.HttpsError(
        'invalid-argument',
        'Organization ID is required',
      )
    const securityService = new SecurityService()
    await securityService.grantOwner(
      request.auth,
      request.data.userId,
      request.data.organizationId,
    )
    return 'Success'
  },
)

export interface RevokeOwnerInput {
  userId?: string
  organizationId?: string
}

export const revokeOwnerFunction = onCall(
  async (request: CallableRequest<RevokeOwnerInput>) => {
    if (!request.data.userId)
      throw new https.HttpsError('invalid-argument', 'User ID is required')
    if (!request.data.organizationId)
      throw new https.HttpsError(
        'invalid-argument',
        'Organization ID is required',
      )
    const securityService = new SecurityService()
    await securityService.revokeOwner(
      request.auth,
      request.data.userId,
      request.data.organizationId,
    )
    return 'Success'
  },
)

export interface GrantAdminInput {
  userId?: string
}

export const grantAdminFunction = onCall(
  async (request: CallableRequest<GrantAdminInput>) => {
    const securityService = new SecurityService()
    if (!request.data.userId)
      throw new https.HttpsError('invalid-argument', 'User ID is required')
    await securityService.grantAdmin(request.auth, request.data.userId)
    return 'Success'
  },
)

export interface RevokeAdminInput {
  userId?: string
}

export const revokeAdminFunction = onCall(
  async (request: CallableRequest<RevokeAdminInput>) => {
    if (!request.data.userId)
      throw new https.HttpsError('invalid-argument', 'User ID is required')
    const securityService = new SecurityService()
    await securityService.revokeAdmin(request.auth, request.data.userId)
    return 'Success'
  },
)
