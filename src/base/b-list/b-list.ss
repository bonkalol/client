- namespace [%fileName%]

/*!
 * V4Fire Client Core
 * https://github.com/V4Fire/Client
 *
 * Released under the MIT license
 * https://github.com/V4Fire/Client/blob/master/LICENSE
 */

- include 'super/i-data'|b as placeholder

- template index() extends ['i-data'].index
	- overWrapper = false
	- listTag = 'ul'
	- listElTag = 'li'

	- block headHelpers
		- super

		/**
		 * Generates list block
		 * @param {!Array<Option>} value - array of values
		 */
		- block list(value)
			< ${listElTag}.&__el v-for = el in ${value}
				< a &
					:class = setHint(el.hintPos).concat(getElClasses({link: {
						id: values[el.value],
						active: isActive(el),
						theme: el.theme,
						hidden: el.hidden,
						progress: el.progress
					}})) |

					:href = el.href |
					:-hint = el.hint |
					:-id = values[el.value]
				.
					- block preIcon
						< span.&__cell.&__link-icon.&__link-pre-icon v-if = $slots.preIcon
							+= self.slot('preIcon')

						< span.&__cell.&__link-icon.&__link-pre-icon v-else-if = el.preIcon
							< component.&__b-icon &
								v-if = el.preIconComponent || el.preIconHint |
								:instanceOf = bIcon |
								:is = el.preIconComponent || 'b-icon' |
								:value = el.preIcon |
								:hint = el.preIconHint
							.

							< template v-else
								+= self.gIcon(['el.preIcon'], {'g-icon': {}})

					- block text
						< span.&__cell.&__link-text v-if = !hideLabels
							{{ t(el.label) }}

					- block info
						< span.&__cell.&__link-info v-if = db && el.info && getField('db.' + el.info)
							{{ getField('db.' + el.info) }}

					- block icon
						< span.&__cell.&__link-icon.&__link-post-icon v-if = $slots.icon
							+= self.slot('icon')

						< span.&__cell.&__link-icon.&__link-post-icon v-else-if = el.icon
							< component.&__b-icon &
								v-if = el.iconComponent || el.iconHint || hideLabels |
								:instanceOf = bIcon |
								:is = el.iconComponent || 'b-icon' |
								:value = el.icon |
								:hint = el.iconHint || (hideLabels ? t(el.label) : undefined)
							.

							< template v-else
								+= self.gIcon(['el.icon'], {'g-icon': {}})

					- block progress
						< span.&__cell.&__link-icon.&__link-progress v-if = dataProvider
							< b-progress-icon v-once

	- block body
		- super

		< ${listTag}.&__wrapper
			+= self.list('value')
