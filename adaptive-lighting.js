module.exports = function(RED) {
    "use strict";
    const SunCalc = require('suncalc');
    const _ = require('lodash');
    const Validate = require('./validate.js');
    function AdaptiveLightingNode(config) {
        RED.nodes.createNode(this,config);
        let node = this;
        this.perTopic = true; // Set in node properties.
        this.delay = 5000;
        this.adaptiveStepTransitionTime = 5000; // in milliseconds.
        this.topics = {}; // List of timer handlers (per topic).
        this.enabled = {}; // List of enable booleans (per topic).

        /**
         * Looks at the errors object (above) and checks for any actions
         * that need to be taken. Does not process warnings, that's done
         * at the end.
         * Marks node as done if there was an error.
         * @returns True if errors.error is set, false otherwise.
         */
            function checkErrors(errors, msg, send, done) {
            if(errors.error !== undefined) {
                if(errors.status !== undefined) {
                    node.status({fill: "red", shape: "dot", text:errors.status});
                }
                if(done) {
                    done(errors.error);
                }
                else {
                    node.error(errors.error, msg);
                }
                return true;
            }
            return false;
        }

        /**
         * Looks at the errors object (above) and checks for any warning
         * or info objects that need reporting. Intended to be run at the
         * end of operation, once all necessary warnings/info has been
         * collected. Once complete, closes the node.
         * @returns True if errors.warn.length > 0, false otherwise.
         * 
         */
        function checkWarningsAndClose(errors, msg, send, done) {
            // node.status is a warning iff there were no errors and at least one warning.
            // node.status is info-only iff there were no errors and no warnings.
            if(errors.status !== undefined) {
                if(errors.error === undefined) {
                    if(Array.isArray(errors.warn) && errors.warn.length > 0) {
                        node.status({fill: "yellow", shape: "dot", text:errors.status});
                    }
                    else {
                        node.status({fill: "grey", shape: "dot", text:errors.status});
                    }
                }
            }
            else { // No status message. Clear any existing prompt.
                node.status({});
            }

            if(Array.isArray(errors.warn)) {
                errors.warn.forEach(warning => {
                    node.warn(errors.warn);
                });
            }

            if(done) {
                done();
            }

            return (Array.isArray(errors.warn) && (errors.warn.length > 0));
        }

        function setTimer(handler, delay, clearHandler) {
            let timerID = setInterval(handler, delay);
            return {
                clear: function() { clearInterval(timerID); clearHandler(); },
                trigger: function() { clearInterval(timerID); return handler(); }
            };
        }

        function clearTimer(topic) {
            let timerTopic = (node.perTopic ? topic : "_none");
            let timer = node.topics[timerTopic];
            if(timer) {
                timer.clear();
            }
        }

        function setupAction(msg, send, done) {
            const result = {
                "errors": {
                    error: undefined,
                    warn: [],
                    status: undefined
                }
            };


            const now_offset = Validate.GetNowOffset(msg, result.errors);
            if(checkErrors(result.errors, msg, send, done)) return result;
            else {
                result.now_offset = now_offset;
                result.now = new Date();
                result.now.setMilliseconds(result.now.getMilliseconds() + now_offset);
            }

            const location = Validate.GetLocation(msg, result.errors);
            if(checkErrors(result.errors, msg, send, done)) return result;
            else result.location = location;

            // Need to update periodically.
            result.suntimes = SunCalc.getTimes(result.now, 
                                               result.location.latitude,
                                               result.location.longitude);

            // Need to update periodically.
            const fades = Validate.GetFades(msg,
                                            result.suntimes,
                                            result.now,
                                            result.errors);
            if(checkErrors(result.errors, msg, send, done)) return result;
            else result.fades = fades;

            result.fades.forEach(vFade => {
                if(result.closestBefore === undefined || result.closestBefore.beforeTime <= vFade.beforeTime) {
                    result.closestBefore = vFade;
                }
                if(result.closestAfter === undefined || result.closestAfter.afterTime > vFade.afterTime) {
                    result.closestAfter = vFade;
                }
            });

            return result;

        }

        function initialAction(validated, msg, send, done, errors) {
            if(node.enabled[validated.topic]) {
                let cloneMsg = RED.util.cloneMessage(msg);
                
                // Calculate fades and add to new or existing msg.payload.data object.
                // First check relevant objects exist.
                if(!cloneMsg) cloneMsg = {};
                if(!cloneMsg.payload) cloneMsg.payload = {};
                if(!cloneMsg.payload.data) cloneMsg.payload.data = {};

                const vData = Validate.Fade(validated.closestBefore, validated.closestAfter, validated.now);
                Object.keys(vData).forEach(key => {
                    cloneMsg.payload.data[key] = vData[key];
                });
                validated.lastData = vData;
                
                cloneMsg.alx_enabled = true;

                send(cloneMsg);
            }
            else {
                send(msg);
            }
        }

        function recurringAction(validated, msg, send, done) {

            // Recalculate `now`.
            validated.now = new Date()
            if(validated.now_offset) {
                validated.now.setMilliseconds(validated.now.getMilliseconds() + validated.now_offset);
            }

            // If `now` lies outside range, recalculate before/after values.
            // Also some sanity checks in case closestBefore/closestAfter not set properly.
            if(validated.closestBefore === undefined || validated.closestBefore.beforeTime === undefined ||
                    validated.closestAfter === undefined || validated.closestAfter.afterTime === undefined ||
                    validated.now < validated.closestBefore.beforeTime || 
                    validated.now > validated.closestAfter.afterTime) {

                // As we are using validated results, we can assume these will all function without error.
                // ... But it doesn't hurt to be sure.
                let errors = {error: undefined, warn: [], status: undefined};

                delete validated.suntimes;
                delete validated.fades;
                delete validated.closestBefore;
                delete validated.closestAfter;

                validated.suntimes = SunCalc.getTimes(validated.now, 
                                                   validated.location.latitude,
                                                   validated.location.longitude);
                validated.fades = Validate.GetFades(msg,
                                                validated.suntimes,
                                                validated.now,
                                                errors);
                if(errors.error !== undefined) {
                    // Shouldn't happen!
                    node.error("Unexpected error in background process: " + errors.error);
                    return;
                }

                validated.fades.forEach(vFade => {
                    if(validated.closestBefore === undefined || validated.closestBefore.beforeTime <= vFade.beforeTime) {
                        validated.closestBefore = vFade;
                    }
                    if(validated.closestAfter === undefined || validated.closestAfter.afterTime > vFade.afterTime) {
                        validated.closestAfter = vFade;
                    }
                });
            }

            // Suppress re-calculation if disabled.
            if(node.enabled[validated.topic]) {
                let cloneMsg = RED.util.cloneMessage(msg);

                // Calculate fades and add to new or existing msg.payload.data object.
                // First check relevant objects exist.
                if(!cloneMsg) cloneMsg = {};
                if(!cloneMsg.payload) cloneMsg.payload = {};
                if(!cloneMsg.payload.data) cloneMsg.payload.data = {};

                const vData = Validate.Fade(validated.closestBefore, validated.closestAfter, validated.now);

                // Check if data has changed since last time.
                let lastDataEqual = true;
                if("lastData" in validated) {
                    Object.keys(vData).forEach(key => {
                        if(!_.isEqual(vData[key],validated.lastData[key])) {
                            lastDataEqual =  false;
                        }
                    });
                }
                else {
                    lastDataEqual = false;
                }
                
                // No need to send new message if it hasn't changed since last.
                if(!lastDataEqual) {                    
                    // Copy data into cloneMsg:
                    Object.keys(vData).forEach(key => {
                        cloneMsg.payload.data[key] = vData[key];
                    });

                    validated.lastData = vData;

                    cloneMsg.alx_enabled = true;

                    // Set transition time (recurring msgs only).
                    cloneMsg.payload.data.transition = node.adaptiveStepTransitionTime / 1000;

                    send(cloneMsg);
                }
            }
        }

        function passThroughAction(msg, send, done) {
            send(msg);
        }

        node.on('input', function(msg, send, done) {
            // See blurb at the top of validate.js on the usage of these objects.
            const errors = {
                error: undefined,
                status: undefined,
                warn: []
            };

            // Check if active.
            let validatedActive = Validate.SwitchOn(msg);

            // Check if validatedActive.enabled flag has changed.
            let enabledChanged = false;
            if("enabled" in validatedActive) { // Setting given.
                if(validatedActive.topic in node.enabled) {
                    enabledChanged = (node.enabled[validatedActive.topic] === validatedActive.enabled);

                }
                node.enabled[validatedActive.topic] = validatedActive.enabled;
            }
            else if(validatedActive.topic in node.enabled) { // Implicitly hasn't changed. Pull it from node.enabled[validatedActive.topic]
                validatedActive.enabled = node.enabled[validatedActive.topic];
            }
            else { // Implicitly hasn't changed, never previously executed. Assume true as default.
                validatedActive.enabled = true;
                node.enabled[validatedActive.topic] = true;
            }


            // Three Cases:
            //  1) msg.validatedActive undefined or empty string.
            //     -> Pass message on, do not cancel any timers.
            if(validatedActive.activate === undefined) {
                passThroughAction(msg, send, done);
            }
            //  2) msg.validatedActive is "turn_on", "on" or true.
            //    -> Cancel existing timers, process msg and start a new timer.
            else if(validatedActive.activate) {
                // Parse input.
                let validatedInput = setupAction(msg, send, done);
                if(checkErrors(validatedInput.errors, msg, send, done)) return;
                validatedInput.topic = validatedActive.topic;

                // Cancel any running background processes on the same topic.
                clearTimer(validatedActive.topic);

                // Calculate and send the initial message.
                initialAction(validatedInput, msg, send, done);

                // Initiate the timer to send the recurring messages.
                node.topics[validatedActive.topic] = setTimer(function() {
                    recurringAction(validatedInput, msg, send, done);},
                    node.delay,
                    () => { delete node.topics[validatedActive.topic] }
                );
                
            }
            //  3) msg.validatedActive is something else (such as "turn_off").
            //    -> Pass message on, cancel existing timers.
            else { // validatedActive.activate === false
                passThroughAction(msg, send, done);
                clearTimer(validatedActive.topic);
            }

            checkWarningsAndClose(errors, msg, send, done);

        });

        node.on('close', function() {
            node.log(node.topics);
            const topicKeys = Object.keys(node.topics);
            topicKeys.forEach(key => {
                node.topics.key.clear();
            });
            node.log(node.topics);
        });
    }
    RED.nodes.registerType("adaptive lighting",AdaptiveLightingNode);
}
