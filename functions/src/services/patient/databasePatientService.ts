//
// This source file is part of the ENGAGE-HF project based on the Stanford Spezi Template Application project
//
// SPDX-FileCopyrightText: 2023 Stanford University
//
// SPDX-License-Identifier: MIT
//

import {
  advanceDateByDays,
  type FHIRAllergyIntolerance,
  type FHIRAppointment,
  type FHIRMedicationRequest,
  type FHIRObservation,
  type FHIRQuestionnaireResponse,
  type SymptomScore,
  type UserMedicationRecommendation,
  UserMedicationRecommendationType,
} from '@stanfordbdhg/engagehf-models'
import { type PatientService } from './patientService.js'
import { UserObservationCollection } from '../database/collections.js'
import {
  type Document,
  type DatabaseService,
} from '../database/databaseService.js'

export class DatabasePatientService implements PatientService {
  // Properties

  private databaseService: DatabaseService

  // Constructor

  constructor(databaseService: DatabaseService) {
    this.databaseService = databaseService
  }

  // Methods - Appointments

  async getEveryAppoinment(
    fromDate: Date,
    toDate: Date,
  ): Promise<Array<Document<FHIRAppointment>>> {
    const result = await this.databaseService.getQuery<FHIRAppointment>(
      (collections) =>
        collections.appointments
          .where('start', '>', advanceDateByDays(fromDate, -1).toISOString())
          .where('start', '<', advanceDateByDays(toDate, 1).toISOString()),
    )

    return result.filter((appointment) => {
      const start = new Date(appointment.content.start)
      return start >= fromDate && start < toDate
    })
  }

  async getAppointments(
    userId: string,
  ): Promise<Array<Document<FHIRAppointment>>> {
    return this.databaseService.getQuery<FHIRAppointment>((collections) =>
      collections.userAppointments(userId),
    )
  }

  async getNextAppointment(
    userId: string,
  ): Promise<Document<FHIRAppointment> | undefined> {
    const result = await this.databaseService.getQuery<FHIRAppointment>(
      (collections) =>
        collections
          .userAppointments(userId)
          .where('start', '>', new Date())
          .orderBy('start', 'asc')
          .limit(1),
    )
    return result.at(0)
  }

  // Methods - Contraindications

  async getContraindications(
    userId: string,
  ): Promise<Array<Document<FHIRAllergyIntolerance>>> {
    return this.databaseService.getQuery<FHIRAllergyIntolerance>(
      (collections) => collections.userAllergyIntolerances(userId),
    )
  }

  // Methods - Medication Requests

  async getMedicationRecommendations(
    userId: string,
  ): Promise<Array<Document<UserMedicationRecommendation>>> {
    const result =
      await this.databaseService.getQuery<UserMedicationRecommendation>(
        (collections) => collections.userMedicationRecommendations(userId),
      )

    return result.sort((a, b) => {
      const priorityDiff =
        this.priorityForRecommendationType(a.content.displayInformation.type) -
        this.priorityForRecommendationType(b.content.displayInformation.type)
      if (priorityDiff !== 0) return priorityDiff

      const medicationClassA = a.content.displayInformation.subtitle.localize()
      const medicationClassB = b.content.displayInformation.subtitle.localize()
      return medicationClassA.localeCompare(medicationClassB, 'en')
    })
  }

  async getMedicationRequests(
    userId: string,
  ): Promise<Array<Document<FHIRMedicationRequest>>> {
    return this.databaseService.getQuery<FHIRMedicationRequest>((collections) =>
      collections.userMedicationRequests(userId),
    )
  }

  async updateMedicationRecommendations(
    userId: string,
    recommendations: UserMedicationRecommendation[],
  ): Promise<boolean> {
    return this.databaseService.runTransaction(
      async (collections, transaction) => {
        const collection = collections.userMedicationRecommendations(userId)
        const result = await transaction.get(collection)
        for (const doc of result.docs) {
          transaction.delete(doc.ref)
        }
        for (const recommendation of recommendations) {
          transaction.create(collection.doc(), recommendation)
        }
        return true // TODO: Check if recommendations actually changed and only return true, if they changed
      },
    )
  }

  // Methods - Observations

  async getBloodPressureObservations(
    userId: string,
    cutoffDate: Date,
  ): Promise<Array<Document<FHIRObservation>>> {
    return this.databaseService.getQuery<FHIRObservation>((collections) =>
      collections
        .userObservations(userId, UserObservationCollection.bloodPressure)
        .where('effectiveDateTime', '>', cutoffDate.toISOString())
        .orderBy('effectiveDateTime', 'desc'),
    )
  }

  async getBodyWeightObservations(
    userId: string,
    cutoffDate: Date,
  ): Promise<Array<Document<FHIRObservation>>> {
    return this.databaseService.getQuery<FHIRObservation>((collections) =>
      collections
        .userObservations(userId, UserObservationCollection.bodyWeight)
        .where('effectiveDateTime', '>', cutoffDate.toISOString())
        .orderBy('effectiveDateTime', 'desc'),
    )
  }

  async getHeartRateObservations(
    userId: string,
    cutoffDate: Date,
  ): Promise<Array<Document<FHIRObservation>>> {
    return this.databaseService.getQuery<FHIRObservation>((collections) =>
      collections
        .userObservations(userId, UserObservationCollection.heartRate)
        .where('effectiveDateTime', '>', cutoffDate.toISOString())
        .orderBy('effectiveDateTime', 'desc'),
    )
  }

  async getMostRecentCreatinineObservation(
    userId: string,
  ): Promise<Document<FHIRObservation> | undefined> {
    const result = await this.databaseService.getQuery<FHIRObservation>(
      (collections) =>
        collections
          .userObservations(userId, UserObservationCollection.creatinine)
          .orderBy('effectiveDateTime', 'desc')
          .limit(1),
    )
    return result.at(0)
  }

  async getMostRecentDryWeightObservation(
    userId: string,
  ): Promise<Document<FHIRObservation> | undefined> {
    const result = await this.databaseService.getQuery<FHIRObservation>(
      (collections) =>
        collections
          .userObservations(userId, UserObservationCollection.dryWeight)
          .orderBy('effectiveDateTime', 'desc')
          .limit(1),
    )
    return result.at(0)
  }

  async getMostRecentEstimatedGlomerularFiltrationRateObservation(
    userId: string,
  ): Promise<Document<FHIRObservation> | undefined> {
    const result = await this.databaseService.getQuery<FHIRObservation>(
      (collections) =>
        collections
          .userObservations(userId, UserObservationCollection.eGfr)
          .orderBy('effectiveDateTime', 'desc')
          .limit(1),
    )
    return result.at(0)
  }

  async getMostRecentPotassiumObservation(
    userId: string,
  ): Promise<Document<FHIRObservation> | undefined> {
    const result = await this.databaseService.getQuery<FHIRObservation>(
      (collections) =>
        collections
          .userObservations(userId, UserObservationCollection.potassium)
          .orderBy('effectiveDateTime', 'desc')
          .limit(1),
    )
    return result.at(0)
  }

  // Methods - Questionnaire Responses

  async getQuestionnaireResponses(
    userId: string,
  ): Promise<Array<Document<FHIRQuestionnaireResponse>>> {
    return this.databaseService.getQuery<FHIRQuestionnaireResponse>(
      (collections) => collections.userQuestionnaireResponses(userId),
    )
  }

  async getSymptomScores(
    userId: string,
    options?: { limit?: number },
  ): Promise<Array<Document<SymptomScore>>> {
    return this.databaseService.getQuery<SymptomScore>((collections) => {
      const query = collections
        .userSymptomScores(userId)
        .orderBy('date', 'desc')
      return options?.limit ? query.limit(options.limit) : query
    })
  }

  async getLatestSymptomScore(
    userId: string,
  ): Promise<Document<SymptomScore> | undefined> {
    const result = await this.databaseService.getQuery<SymptomScore>(
      (collections) =>
        collections.userSymptomScores(userId).orderBy('date', 'desc').limit(1),
    )
    return result.at(0)
  }

  async updateSymptomScore(
    userId: string,
    symptomScoreId: string,
    symptomScore: SymptomScore | undefined,
  ): Promise<void> {
    return this.databaseService.runTransaction((collections, transaction) => {
      const ref = collections.userSymptomScores(userId).doc(symptomScoreId)
      if (symptomScore) {
        transaction.set(ref, symptomScore)
      } else {
        transaction.delete(ref)
      }
    })
  }

  // Helpers

  private priorityForRecommendationType(
    type: UserMedicationRecommendationType,
  ): number {
    switch (type) {
      case UserMedicationRecommendationType.improvementAvailable:
        return 1
      case UserMedicationRecommendationType.morePatientObservationsRequired:
        return 2
      case UserMedicationRecommendationType.moreLabObservationsRequired:
        return 3
      case UserMedicationRecommendationType.personalTargetDoseReached:
        return 4
      case UserMedicationRecommendationType.targetDoseReached:
        return 5
      case UserMedicationRecommendationType.notStarted:
        return 6
      case UserMedicationRecommendationType.noActionRequired:
        return 7
    }
  }
}
