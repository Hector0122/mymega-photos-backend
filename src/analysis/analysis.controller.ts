import {
  Controller,
  Get,
  Post,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AnalysisService } from './analysis.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Post('photos/analyze-all')
  @HttpCode(HttpStatus.OK)
  async analyzeAllPhotos(@CurrentUser() user: { id: string }) {
    return this.analysisService.analyzeAllPhotos(user.id);
  }

  @Post('photos/:id/analyze')
  @HttpCode(HttpStatus.OK)
  async analyzePhoto(
    @CurrentUser() _user: { id: string },
    @Param('id') id: string,
  ) {
    return this.analysisService.analyzePhoto(id);
  }

  @Get('photos/duplicates')
  async getDuplicates(@CurrentUser() user: { id: string }) {
    return this.analysisService.getDuplicates(user.id);
  }
}
