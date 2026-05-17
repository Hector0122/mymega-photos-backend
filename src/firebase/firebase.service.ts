import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaService } from '../prisma.service';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    const jsonStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    let serviceAccount: admin.ServiceAccount | undefined;
    if (jsonStr) {
      try {
        serviceAccount = JSON.parse(jsonStr);
      } catch {
        this.logger.error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
      }
    } else {
      const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
      if (serviceAccountPath) {
        try {
          const resolvedPath = path.resolve(process.cwd(), serviceAccountPath);
          serviceAccount = JSON.parse(
            fs.readFileSync(resolvedPath, 'utf-8'),
          );
        } catch (err) {
          this.logger.error('Failed to read Firebase service account file', err);
        }
      }
    }
    if (!serviceAccount) {
      this.logger.warn(
        'FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH not set — push notifications disabled',
      );
      return;
    }
    try {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      this.logger.log('Firebase Admin initialized');
    } catch (err) {
      this.logger.error('Failed to initialize Firebase Admin', err);
    }
  }

  async sendToUser(
    userId: string,
    payload: { title: string; body: string; data?: Record<string, string> },
  ) {
    if (!admin.apps.length) return;

    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true },
    });
    if (tokens.length === 0) return;

    const registrationTokens = tokens.map((t) => t.token);
    const message: admin.messaging.MulticastMessage = {
      tokens: registrationTokens,
      notification: { title: payload.title, body: payload.body },
      android: {
        notification: {
          channelId: 'vaulta_export',
          icon: 'ic_notification',
          color: '#007AFF',
          priority: 'high',
          sound: 'default',
        },
      },
      data: payload.data,
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    this.logger.log(
      `Push sent: ${response.successCount} success, ${response.failureCount} failure`,
    );

    const failedTokens: string[] = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success && resp.error) {
        if (resp.error.code === 'messaging/registration-token-not-registered') {
          failedTokens.push(registrationTokens[idx]);
        }
      }
    });

    if (failedTokens.length > 0) {
      await this.prisma.deviceToken.deleteMany({
        where: { token: { in: failedTokens }, userId },
      });
      this.logger.log(`Cleaned ${failedTokens.length} stale device tokens`);
    }
  }
}
