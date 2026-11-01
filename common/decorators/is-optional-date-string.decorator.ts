import { applyDecorators } from '@nestjs/common';
import { IsDateString, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

// class-validator @IsOptional() ne saute la validation que si la valeur est
// undefined/null — une chaîne vide ("") venant d'un <input type="date"> non
// rempli reste rejetée par @IsDateString(). Ce décorateur normalise "" et
// null en undefined avant validation, pour que les dates optionnelles soient
// réellement optionnelles.
export function IsOptionalDateString() {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      value === '' || value === null ? undefined : value,
    ),
    IsOptional(),
    IsDateString(),
  );
}
