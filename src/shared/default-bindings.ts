import { parse } from 'yaml'
import { bindingSchema, mappingSchema } from './schema'
import bindings from '../../resources/defaults/bindings.yaml?raw'
import arturia from '../../resources/defaults/mappings/arturia-keylab-essential-mk3.yaml?raw'
import axiom from '../../resources/defaults/mappings/m-audio-axiom-61-mk2.yaml?raw'
export const defaultBindings = bindingSchema
  .array()
  .parse(parse(bindings).bindings)
export const defaultMappings = {
  'arturia-keylab-essential-mk3': mappingSchema.parse(parse(arturia)),
  'm-audio-axiom-61-mk2': mappingSchema.parse(parse(axiom)),
}
