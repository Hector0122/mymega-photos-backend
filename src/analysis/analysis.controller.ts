import {
  Controller,
  Get,
  Post,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AnalysisService } from './analysis.service';

@Controller()
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Post('photos/:id/analyze')
  @HttpCode(HttpStatus.OK)
  async analyzePhoto(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.analysisService.analyzePhoto(user.id, id);
  }

  @Get('photos/duplicates')
  async getDuplicates(@CurrentUser() user: { id: string }) {
    return this.analysisService.getDuplicates(user.id);
  }
}
