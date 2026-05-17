import { Global, Module } from '@nestjs/common';
import { s3Provider, S3_CLIENT } from './s3.provider';

@Global()
@Module({
  providers: [s3Provider],
  exports: [S3_CLIENT],
})
export class S3Module {}
