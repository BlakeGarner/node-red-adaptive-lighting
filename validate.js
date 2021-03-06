(function() {

    "use strict";

    const MIN_LATITUDE = -90;
    const MAX_LATITUDE = 90;
    const MIN_LONGITUDE = -180;
    const MAX_LONGITUDE = 180;

    const MINIMUM_OFFSET_MINS = -720;
    const MAXIMUM_OFFSET_MINS = 720;
    
    const MAX_BRIGHTNESS = 255;
    const MAX_BRIGHTNESS_PERCENT = 100;
    const MIN_MIREDS = 150;
    const MAX_MIREDS = 500;
    const MIN_KELVIN = 2000;
    const MAX_KELVIN = 6500;
    
    const MAX_RGB = 255;
    const MAX_HUE = 360.0;
    const MAX_SAT = 100.0;
    const MAX_XY = 1.0;
    
    const REGEX_HHMM = /^(2[0-3]|[01]?[0-9]):([0-5][0-9])$/

    // A note on the errors object:
    // errors.error: is a critical error and the function will not be able to
    //               return a sensible result. The function should return as
    //               soon as it (safely) can here, as there's no point
    //               processiong any further. As a result, only one error can
    //               or should be set.
    // errors.warn: This is an array of warnings generated by this and
    //              previously called functions. The array may already have
    //              existing warnings in here, and this function should add to
    //              them, not replace them.
    // errors.status: This is the string for the node status, ad should aim to
    //                be 32 characters or less. It may already be set due to a
    //                previous warning. If the status message is related to an
    //                error, it can be set without checking. If the status
    //                message is being set as a warning or other reason, it
    //                should only be set if currently undefined (i.e., do not
    //                stomp existing warning or status messages unless an
    //                error). 
    //                The implementing node should assume the status message is:
    //                  - an error (red dot) if errors.error is set.
    //                  - a warning (yellow dot) if errors.warn.length > 0.
    //                  - a note (grey dot) otherwise.



    module.exports.SwitchOn = function(msg) {
        let result = {};
        if(msg && "topic" in msg && msg.topic !== "") {
            result.topic = msg.topic;
        }
        else {
            result.topic = "_none";
        }
        if(msg && msg.payload) {
            if(msg.payload.service === "turn_on" || msg.payload.service === "on" || msg.payload.service === true) {
                result.activate = true;
            }
            else if(msg.payload.service !== undefined && msg.payload.service !== "" && msg.payload.service !== null) {
                result.activate = false;
            }
            // else result.activate not assigned (no change made).
        }
        if(msg && "alx_enabled" in msg) {
            if(msg.alx_enabled && msg.alx_enabled !== "false") {
                result.enabled = true;
            }
            else {
                result.enabled = false;
            }
        }
        return result;
    }

    /**
     * Pulls the latitude and longitude from `msg.location`, validating all 
     * aspects along the way. Returns undefined if there was a validation
     * error, the result otherwise.
     * @param {*} msg Message containing location.
     * @param {*} errors Error object, to update with any new errors:
     * - errors.error: String for any error message. Return type will be undefined.
     * - errors.warning: Array of warnings. Add any new warnings to the array.
     * - errors.status: Message for node's status.
     * @returns Object containing parsed location. For example:
     *  {latitude: 53.63, longitude: -151.2}
     */
    module.exports.GetLocation = function(msg, errors) {
        const result = {};
        if(!(msg && msg.location && 
                msg.location.latitude !== undefined && 
                msg.location.longitude !== undefined)) {
            errors.error = "msg.location.latitude and/or msg.location.longitude not defined.";
            errors.error = "msg.location error!";
        }
        else {
            result.latitude = parseFloat(msg.location.latitude);
            result.longitude = parseFloat(msg.location.longitude);
            if(isNaN(result.latitude)) {
                errors.error = `msg.location.latitude ${msg.location.latitude} is not a number.`;
                errors.status = "msg.location error!";
            }
            else if(result.latitude < MIN_LATITUDE || result.latitude > MAX_LATITUDE) {
                errors.error = `msg.location.latitude ${msg.location.latitude} is not between -90 and 90 degrees.`;
                errors.status = "msg.location error!";
            }
            else if(isNaN(result.longitude)) {
                errors.error = `msg.location.longitude ${msg.location.longitude} is not a number.`;
                errors.status = "msg.location error!";
            }
            else if(result.longitude < MIN_LONGITUDE || result.longitude > MAX_LONGITUDE) {
                errors.error = `msg.location.longitude ${msg.location.longitude} is not between -180 and 180 degrees.`;
                errors.status = "msg.location error!";
            }
            else {
                // All parsed successfully.
                return result;
            }
        }
        return; // Error occured above. Returns undefined
    }

    /**
     * Pulls and validates the array of fade objects within `msg.fades`. Checks
     * and validates the following in each array object:
     * - time: One of the valid entries from SunCalc or a 24hr time
     * in the format hh:mm (Required)
     * - offset_mins: An offset in minutes to apply to `time` above. (Optional)
     * - brightness: The brightness in the form 0 to 255. (Optional)
     * - brightness_pct: The brightness in the form 0 to 100. (Optional)
     * - color_temp: The colour temperature in mireds. (Optional)
     * - kelvin: The colour temperature in kelvin. (Optional)
     * - rgb_color: The colour as a 3-element array of values 0 to 255. (Optional)
     * - rgbw_color: The colour as a 4-element array of values 0 to 255. (Optional)
     * - rgbww_color: The colour as a 5-element array of values 0 to 255. (Optional)
     * - hs_color: The colour as a 2-element array of values 0 to 360 and 0 to
     * 100 respectively. (Optional)
     * - xy_colour: The colour as a 2-element array of values 0.0 to 1.0. (Optional)
     * @param {Object} msg The msg object containing the `fades` array.
     * @param {Array} suntimes The list of suntimes generated by SunCalc.
     * @param {Date} now "now" - provided by an argument so it can be overrriden
     * from the system clock if required.
     * @param {Object} errors Error object, to update with any new errors:
     * - errors.error: String for any error message. Return type will be undefined.
     * - errors.warning: Array of warnings. Add any new warnings to the array.
     * - errors.status: Message for node's status.
     * @returns  Array containing parsed and validated fade objects. Adds the
     * following elements:
     * - beforeTime: resolved time (combining `time` and `offset_mins`) that 
     * occured within the last day before `now`.
     * before `now`.
     * - afterTime: resolved time (combining `time` and `offset_mins`) that
     * will occur within the next day after `now`.
     * All other values are parsed and validated versions of those supplied in
     * the original msg.fades element.
     */
    module.exports.GetFades = function(msg, suntimes, now, errors) {
        const result = [];
        if(!(msg && msg.fades)) {
            errors.error = "fades not defined in msg.";
            errors.status = "msg.fades error!";
        }
        else if(!Array.isArray(msg.fades)) {
            errors.error = "msg.fades is not an array.";
            errors.status = "msg.fades error!";
        }
        else {
            // Process each element in msg.fades array
            msg.fades.forEach((fade, index) => {
                const fadeResult = {};

                // Validate time.
                // If time is invalid, ignore entire element in array.
                if(!(fade && fade.time !== undefined)) {
                    errors.warn.push(`time not defined in msg.fades[${index}].`);
                    if(!errors.status) errors.status = `msg.fades[${index}] is invalid!`;
                    return; // Cuts to next element in forEach loop.
                }
                else if(!(fade.time in suntimes) && !REGEX_HHMM.test(fade.time)) {
                    const allowedSunTimes = Object.keys(suntimes).toString().replace(/,/g, ', ');
                    errors.warn.push(`Invalid time '${fade.time}' provided within msg.fades[${index}]. ` +
                                     `Must be either ${allowedSunTimes} or in the form hh:mm`);
                    if(!errors.status) errors.status = `msg.fades[${index}] is invalid!`
                    return; // Cuts to next element in forEach loop.
                }
                else {
                    fadeResult.time = fade.time;
                }

                // Validate offset_mins
                // If offset_mins is invalid, assume 0.
                if(!(fade && fade.offset_mins !== undefined)) {
                    // Permitted case. Assume no offset.
                    fadeResult.offset_mins = 0;
                }
                else {
                    fadeResult.offset_mins = parseInt(fade.offset_mins);

                    if(isNaN(fadeResult.offset_mins)) {
                        errors.warn.push(`Invalid msg.fades[${index}].offset_mins '${fade.offset_mins}'. ` + 
                                         `Must be an integer.`);
                        if(!errors.status) errors.status = `msg.fades[${index}].offset_mins is invalid!`
                        fadeResult.offset_mins = 0;
                    }
                    else if(fadeResult.offset_mins < MINIMUM_OFFSET_MINS ||
                            fadeResult.offset_mins > MAXIMUM_OFFSET_MINS) {
                        errors.warn.push(`Invaild msg.fades[${index}].offset_mins '${fade.offset_mins}'. ` +
                                         `Must be within the range ${MINIMUM_OFFSET_MINS} to ${MAXIMUM_OFFSET_MINS}.`);
                        if(!errors.status) errors.status = `msg.fades[${index}].offset_mins is invalid!`
                        fadeResult.offset_mins = 0;
                    }
                }

                // Validate brightness
                if(fade && fade.brightness !== undefined) {
                    fadeResult.brightness = parseInt(fade.brightness);
                    if(isNaN(fadeResult.brightness)) {
                        errors.warn.push(`Invalid msg.fades[${index}].brightness '${fade.brightness}'. ` +
                                         `Must be an integer.`);
                        if(!errors.status) errors.status = `msg.fades[${index}].brightness is invalid!`
                        delete fadeResult.brightness;
                    }
                    else if(fadeResult.brightness < 0 || fadeResult.brightness > MAX_BRIGHTNESS) {
                        errors.warn.push(`Invalid msg.fades[${index}].brightness '${fade.brightness}'. ` +
                                         `Must be between 0 and ${MAX_BRIGHTNESS}.`);
                        if(!errors.status) errors.status = `msg.fades[${index}].brightness is invalid!`
                        delete fadeResult.brightness;
                    }
                }

                // Validate brightness_pct
                if(fade && fade.brightness_pct !== undefined) {
                    fadeResult.brightness_pct = parseFloat(fade.brightness_pct);
                    if(isNaN(fadeResult.brightness_pct)) {
                        errors.warn.push(`Invalid msg.fades[${index}].brightness_pct '${fade.brightness_pct}'. ` +
                                         `Must be a number.`);
                        if(!errors.status) errors.status = `msg.fades[${index}].brightness_pct is invalid!`
                        delete fadeResult.brightness_pct;
                    }
                    else if(fadeResult.brightness_pct < 0 || fadeResult.brightness_pct > MAX_BRIGHTNESS_PERCENT) {
                        errors.warn.push(`Invalid msg.fades[${index}].brightness_pct '${fade.brightness_pct}'. ` +
                                         `Must be between 0 and ${MAX_BRIGHTNESS_PERCENT}.`);
                        if(!errors.status) errors.status = `msg.fades[${index}].brightness_pct is invalid!`
                        delete fadeResult.brightness_pct;
                    }
                }
                
                // Validate color_temp (mireds)
                if(fade && fade.color_temp !== undefined) {
                    fadeResult.color_temp = parseFloat(fade.color_temp);
                    if(isNaN(fadeResult.color_temp)) {
                        errors.warn.push(`Invalid msg.fades[${index}].color_temp '${fade.color_temp}'. ` +
                                         `Must be a number.`);
                        if(!errors.status) errors.status = `msg.fades[${index}].color_temp is invalid!`
                        delete fadeResult.color_temp;
                    }
                    else if(fadeResult.color_temp < MIN_MIREDS || fadeResult.color_temp > MAX_MIREDS) {
                        errors.warn.push(`Invalid msg.fades[${index}].color_temp '${fade.color_temp}'. ` +
                                         `Must be between ${MIN_MIREDS} and ${MAX_MIREDS}.`);
                        if(!errors.status) errors.status = `msg.fades[${index}].color_temp is invalid!`
                        delete fadeResult.color_temp;
                    }
                }

                // Validate kelvin (colour temperature)
                if(fade && fade.kelvin !== undefined) {
                    fadeResult.kelvin = parseFloat(fade.kelvin);
                    if(isNaN(fadeResult.kelvin)) {
                        errors.warn.push(`Invalid msg.fades[${index}].kelvin '${fade.kelvin}'. ` +
                                         `Must be a number.`);
                        if(!errors.status) errors.status = `msg.fades[${index}].kelvin is invalid!`
                        delete fadeResult.kelvin;
                    }
                    else if(fadeResult.kelvin < MIN_KELVIN || fadeResult.kelvin > MAX_KELVIN) {
                        errors.warn.push(`Invalid msg.fades[${index}].kelvin '${fade.kelvin}'. ` +
                                         `Must be between ${MIN_KELVIN} and ${MAX_KELVIN}.`);
                        if(!errors.status) errors.status = `msg.fades[${index}].kelvin is invalid!`;
                        delete fadeResult.kelvin;
                    }
                }

                // Validate rgb_color
                if(fade && fade.rgb_color !== undefined) {
                    if(Array.isArray(fade.rgb_color) && fade.rgb_color.length === 3) {
                        fadeResult.rgb_color = Array(3);
                        fade.rgb_color.forEach((value, index) => {
                            fadeResult.rgb_color[index] = parseInt(value);
                        });
                        if(!fadeResult.rgb_color.every(value => 
                                Number.isInteger(value) && 
                                value >= 0 && value <= MAX_RGB)) {
                            errors.warn.push(`Invalid values in msg.fades[${index}].rgb_color '${fade.rgb_color}'. ` +
                                             `Must be 3x integers between 0 and ${MAX_RGB}.`);
                            if(!errors.status) errors.status = `msg.fades[${index}].rgb_color is invalid!`;
                            delete fadeResult.rgb_color;
                        }
                    }
                    else {
                        errors.warn.push(`Invalid msg.fades[${index}].rgb_color '${fade.rgb_color}'. ` +
                                         `Must be an array of exactly 3 numbers.`)
                        if(!errors.status) errors.status = `msg.fades[${index}].rgb_color is invalid!`;
                    }
                }
                // Validate rgbw_color
                if(fade && fade.rgbw_color !== undefined) {
                    if(Array.isArray(fade.rgbw_color) && fade.rgbw_color.length === 4) {
                        fadeResult.rgbw_color = Array(4);
                        fade.rgbw_color.forEach((value, index) => {
                            fadeResult.rgbw_color[index] = parseInt(value);
                        });
                        if(!fadeResult.rgbw_color.every(value => 
                                Number.isInteger(value) && 
                                value >= 0 && value <= MAX_RGB)) {
                            errors.warn.push(`Invalid values in msg.fades[${index}].rgbw_color '${fade.rgbw_color}'. ` +
                                             `Must be 4x integers between 0 and ${MAX_RGB}.`);
                            if(!errors.status) errors.status = `msg.fades[${index}].rgbw_color is invalid!`;
                            delete fadeResult.rgbw_color;
                        }
                    }
                    else {
                        errors.warn.push(`Invalid msg.fades[${index}].rgbw_color '${fade.rgbw_color}'. ` +
                                         `Must be an array of exactly 4 numbers.`)
                        if(!errors.status) errors.status = `msg.fades[${index}].rgbw_color is invalid!`;
                    }
                }
                // Validate rgbww_color
                if(fade && fade.rgbww_color !== undefined) {
                    if(Array.isArray(fade.rgbww_color) && fade.rgbww_color.length === 5) {
                        fadeResult.rgbww_color = Array(5);
                        fade.rgbww_color.forEach((value, index) => {
                            fadeResult.rgbww_color[index] = parseInt(value);
                        });
                        if(!fadeResult.rgbww_color.every(value => 
                                Number.isInteger(value) && 
                                value >= 0 && value <= MAX_RGB)) {
                            errors.warn.push(`Invalid values in msg.fades[${index}].rgbww_color '${fade.rgbww_color}'. ` +
                                             `Must be 5x integers between 0 and ${MAX_RGB}.`);
                            if(!errors.status) errors.status = `msg.fades[${index}].rgbww_color is invalid!`;
                            delete fadeResult.rgbww_color;
                        }
                    }
                    else {
                        errors.warn.push(`Invalid msg.fades[${index}].rgbww_color '${fade.rgbww_color}'. ` +
                                         `Must be an array of exactly 5 numbers.`)
                        if(!errors.status) errors.status = `msg.fades[${index}].rgbww_color is invalid!`;
                    }
                }

                // Validate hs_color
                if(fade && fade.hs_color !== undefined) {
                    if(Array.isArray(fade.hs_color) && fade.hs_color.length === 2) {
                        fadeResult.hs_color = Array(2);
                        fade.hs_color.forEach((value, index) => {
                            fadeResult.hs_color[index] = parseFloat(value);
                        });
                        if(!Number.isFinite(fadeResult.hs_color[0]) ||
                                fadeResult.hs_color[0] < 0.0 ||
                                fadeResult.hs_color[0] > MAX_HUE ||
                                !Number.isFinite(fadeResult.hs_color[1]) ||
                                fadeResult.hs_color[1] < 0.0 ||
                                fadeResult.hs_color[1] > MAX_SAT) {
                            errors.warn.push(`Invalid values in msg.fades[${index}].hs_color '${fade.hs_color}'. ` +
                                             `Must be 2x numbers, first element between 0 and ${MAX_HUE} and second ` +
                                             `number between 0 and ${MAX_SAT}.`);
                            if(!errors.status) errors.status = `msg.fades[${index}].hs_color is invalid!`;
                            delete fadeResult.hs_color;
                        }
                    }
                    else {
                        errors.warn.push(`Invalid msg.fades[${index}].hs_color '${fade.hs_color}'. ` +
                                         `Must be an array of exactly 2 numbers.`)
                        if(!errors.status) errors.status = `msg.fades[${index}].hs_color is invalid!`;
                    }
                }

                // Validate xy_color
                if(fade && fade.xy_color !== undefined) {
                    if(Array.isArray(fade.xy_color) && fade.xy_color.length === 2) {
                        fadeResult.xy_color = Array(2);
                        fade.xy_color.forEach((value, index) => {
                            fadeResult.xy_color[index] = parseFloat(value);
                        });
                        if(!fadeResult.xy_color.every(value => 
                                Number.isFinite(value) && 
                                value >= 0 && value <= MAX_XY)) {
                            errors.warn.push(`Invalid values in msg.fades[${index}].xy_color '${fade.xy_color}'. ` +
                                             `Must be 2x numbers between 0 and ${MAX_XY}.`);
                            if(!errors.status) errors.status = `msg.fades[${index}].xy_color is invalid!`;
                            delete fadeResult.xy_color;
                        }
                    }
                    else {
                        errors.warn.push(`Invalid msg.fades[${index}].xy_color '${fade.xy_color}'. ` +
                                         `Must be an array of exactly 2 numbers.`)
                        if(!errors.status) errors.status = `msg.fades[${index}].xy_color is invalid!`;
                    }
                }
                // Must have time _and_ offset_mins.
                // Must have _at_least_one_ of brightness,...,xy.
                if("time" in fadeResult && "offset_mins" in fadeResult && (
                        "brightness" in fadeResult || 
                        "brightness_pct" in fadeResult ||
                        "color_temp" in fadeResult ||
                        "kelvin" in fadeResult ||
                        "rgb_color" in fadeResult ||
                        "rgbw_color" in fadeResult ||
                        "rgbww_color" in fadeResult ||
                        "hs_color" in fadeResult ||
                        "xy_color" in fadeResult)
                    ) {
                    
                    // Pull time from either the suntimes...
                    if(fadeResult.time in suntimes) {
                        fadeResult.beforeTime = new Date(suntimes[fadeResult.time]);
                    }
                    // ...or absolute time, if that's what was given.
                    else {
                        fadeResult.beforeTime = new Date(now);
                        fadeResult.beforeTime.setHours(parseInt(fade.time.split(':')[0]));
                        fadeResult.beforeTime.setMinutes(parseInt(fade.time.split(':')[1]));
                        fadeResult.beforeTime.setSeconds(0);
                        fadeResult.beforeTime.setMilliseconds(0);
                    }

                    // Apply the offset.
                    fadeResult.beforeTime.setMinutes(fadeResult.beforeTime.getMinutes() + fadeResult.offset_mins);
                    // Copy to afterTime.
                    fadeResult.afterTime = new Date(fadeResult.beforeTime);

                    // Normalise beforeTime and afterTime to nearest times before and after now.
                    const diffInDays = (fadeResult.beforeTime - now) / (1000*60*60*24);
                    fadeResult.beforeTime.setDate(fadeResult.beforeTime.getDate() - Math.ceil(diffInDays));
                    fadeResult.afterTime.setDate(fadeResult.afterTime.getDate() - Math.floor(diffInDays));

                    // Parsed and validated single element successfully! Add to the array.
                    result.push(fadeResult);
                }
                else { // No valid brightness,...,xy values found in fadeResult.
                    errors.warn.push(`No levels provided within msg.fades[${index}]. Skipping.`);
                    if(!errors.status) errors.status = `msg.fades[${index}] is invalid!`
                }
            });

            // Final checks - need at least two valid entries to be valid.
            if(result.length < 2) {
                errors.error(`msg.fades had fewer than 2 valid entries.`);
                errors.status(`msg.fades length error!`);
                return;
            }
            // Parsed and validated enough elements successfully!
            return result;
        }
    }



    /**
     * Determines the offset (in ms) between now and the date supplied. Or 0 if not present or validation fails.
     * If msg.now is not defined, that's considered okay, and 0 is returned.
     * If msg.now is defined but invalid, that's a warning, and 0 is returned.
     * If msg.now is defined and valid, the difference between now and msg.now is returned.
     * @param {Object} msg  The msg that may or may not contain msg.now.
     * @param {Object} errors Error object, to update with any new errors:
     * - errors.error: String for any error message. Return type will be undefined.
     * - errors.warning: Array of warnings. Add any new warnings to the array.
     * - errors.status: Message for node's status.
     * @returns Difference betwween current date/time and supplied date/time in msg.now, or 0 if not supplied.
     */
    module.exports.GetNowOffset = function(msg, errors) {
        const now = new Date(); // Now.

        if(msg && msg.now !== undefined) {
            const result = Date.parse(msg.now);
            if(isNaN(result)) {
                errors.warn.push(`Invalid format provided for msg.now ${msg.now}. ` + 
                    `Use format yyyy-mm-ddThh:mm:ss.sssZ where Z means GMT, or -/+hhmm for another timezone.`);
                if(!errors.status) errors.status = "msg.now invalid!";
            }
            else { // Parsed okay.
                return result - now;
            }
        }
        return 0;
        //return new Date(); // Parse error or not supplied.
    }

    /**
     * Calculates the fade between any applicable parameters in both before
     * and after, given the current time.
     * Progress is calculated by taking the `before` and `after` times, and 
     * determining where `now` lies propertionally within that range.
     * Assumes all values provided have been validated.
     * @param {*} before An object containing all starting values. As generated
     * by the `GetFades` function.
     * @param {*} after An object containing all destination values. As generated
     * by the `GetFades` function.
     * @param {Date} now The current time. If `now` lies outside the range 
     * `before.beforeTime` to `after.afterTime`, all calculations will be 
     * performed on a version of `now` constrained to that range.
     * @returns The proportional progress on each attribute type, within an object.
     * If `before.beforeTime` does not contain a date/time earlier than `after.afterTime`,
     * the function will return immediately with no value (undefined).
     */
    module.exports.Fade = function(before, after, now) {
        if(before.beforeTime > after.afterTime) {
            return;
        }
        const result = {};

        // Calculate progress through fade, constraining it to the range 0 to 1.
        const progress = Math.max(0.0, Math.min(1.0, 
            (now - before.beforeTime) / (after.afterTime - before.beforeTime)));

        // Go through and check each supported paremeter, noting:
        // - The parameter must exist in both `before` and `after`.
        // - Results are constrained to the parameter's min/max values.
        // - Some parameters contain arrays, in which case array element needs
        //   to be calculated and constrained one-by-one.

        if("brightness" in before && "brightness" in after) {
            result.brightness = Math.max(0, Math.min(MAX_BRIGHTNESS, Math.round(
                progress * (after.brightness - before.brightness) + before.brightness
            )));
        }
        if("brightness_pct" in before && "brightness_pct" in after) {
            result.brightness_pct = Math.max(0, Math.min(MAX_BRIGHTNESS_PERCENT, Math.round(
                progress * (after.brightness_pct - before.brightness_pct) + before.brightness_pct
            )));
        }
        if("color_temp" in before && "color_temp" in after) {
            result.color_temp = Math.max(MIN_MIREDS, Math.min(MAX_MIREDS, Math.round(
                progress * (after.color_temp - before.color_temp) + before.color_temp
            )));
        }
        if("kelvin" in before && "kelvin" in after) {
            result.kelvin = Math.max(MIN_KELVIN, Math.min(MAX_KELVIN, Math.round(
                progress * (after.kelvin - before.kelvin) + before.kelvin
            )));
        }
        if("rgb_color" in before && "rgb_color" in after) {
            result.rgb_color = Array(3);
            [0,1,2].forEach(i => {
                result.rgb_color[i] = Math.max(0, Math.min(MAX_RGB, Math.round(
                    progress * (after.rgb_color[i] - before.rgb_color[i]) + before.rgb_color[i]
                )));
            });
        }
        if("rgbw_color" in before && "rgbw_color" in after) {
            result.rgbw_color = Array(4);
            [0,1,2,3].forEach(i => {
                result.rgbw_color[i] = Math.max(0, Math.min(MAX_RGB, Math.round(
                    progress * (after.rgbw_color[i] - before.rgbw_color[i]) + before.rgbw_color[i]
                )));
            });
        }
        if("rgbww_color" in before && "rgbww_color" in after) {
            result.rgbww_color = Array(5);
            [0,1,2,3,4].forEach(i => {
                result.rgbww_color[i] = Math.max(0, Math.min(MAX_RGB, Math.round(
                    progress * (after.rgbww_color[i] - before.rgbww_color[i]) + before.rgbww_color[i]
                )));
            });
        }
        if("hs_color" in before && "hs_color" in after) {
            result.hs_color = Array(2);
            result.hs_color[0] = Math.max(0, Math.min(MAX_HUE, 
                progress * (after.hs_color[0] - before.hs_color[0]) + before.hs_color[0]
            ));
            result.hs_color[1] = Math.max(0, Math.min(MAX_SAT, 
                progress * (after.hs_color[1] - before.hs_color[1]) + before.hs_color[1]
            ));
        }
        if("xy_color" in before && "xy_color" in after) {
            result.xy_color = Array(2);
            [0,1].forEach(i => {
                result.xy_color[i] = Math.max(0, Math.min(MAX_XY, 
                    progress * (after.xy_color[i] - before.xy_color[i]) + before.xy_color[i]
                ));
            });
        }
        return result;
    }

    module.exports.IsStaticFade = function(before, after) {
        values = ["brightness", "brightness_pct", "color_temp", "kelvin",
                  "rgb_color", "rgbw_color", "rgbww_color", "hs_color", "xy_color"];
        values.forEach(val => {
            // Check entry is in both sides firstly.
            if(val in before && val in after) {
                // Check is number.
                if(isFinite(before[val]) && isFinite(after[val])) {
                    // Check if equal.
                    if(before[val] !== after[val]) {
                        return false;
                    }
                }
                // If not number, check is array.
                else if(Array.isArray(before[val]) && Array.isArray(after[val])) {
                    // Check arrays are same length.
                    if(before[val].length === after[val].length) {
                        for(i = 0; i < before[val].length; i++) {
                            // Check single element is equal.
                            if(before[val][i] !== after[val][i]) {
                                return false;
                            }
                        }
                    }
                    else {
                        return false;
                    }
                }
                else {
                    // Unknown type.
                }
            }
        });
        return true;
    }
}());