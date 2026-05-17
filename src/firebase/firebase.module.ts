import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { FirebaseService } from './firebase.service';
import { DeviceTokenController } from './device-token.controller';

@Module({
  imports: [PrismaModule],
  controllers: [DeviceTokenController],
  providers: [FirebaseService],
  exports: [FirebaseService],
})
export class FirebaseModule {}
