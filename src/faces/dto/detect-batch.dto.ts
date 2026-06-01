import { IsArray, ArrayMinSize, IsString } from 'class-validator'

export class DetectBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  photoIds: string[]
}
