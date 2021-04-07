
import { AppointmentUpdateFields } from "../../domain/repositories";
import { IAppointment, IAppointmentRepository, AppointmentStatusType, makeAppointment, makeClient, makeCarListing } from "../../domain";
import { CarListingModel, ClientModel, ICarListingModel, IClientModel } from "../models";
import { AppointmentModel } from "../models/appointmentmodel";
import { carListingRepo } from "..";


export default class AppointmentRepository implements IAppointmentRepository {
    

    private calcEndDate(date:Date, days:number) {
        let endDate = new Date(date)
        endDate.setDate(endDate.getDate() + days)
        return endDate
    }

    async createAppointment(appointment: IAppointment): Promise<IAppointment | null> {
        let rentee = await ClientModel
            .findOne({email: appointment.rentee.email}, '_id')
            .lean()
            .exec()

        let listing = await CarListingModel
            .findOne({licensePlate: appointment.carListing.licensePlate}, '_id')
            .lean()
            .exec()

        if (!listing || !rentee) return null;

        const appointmentDataModel = new AppointmentModel({
            rentee: rentee?._id,
            carListing: listing?._id,
            status: appointment.status,
            dateInformation: appointment.dateInformation,
            location: {
                meetupLocation:{
                    type: "Point",
                    coordinates: [appointment.location.meetupLocation.lat, appointment.location.meetupLocation.lon],
                    address: appointment.location.meetupLocation.address                
                },
                dropoffLocation: {
                    type: "Point",
                    coordinates: [appointment.location.dropoffLocation.lat, appointment.location.dropoffLocation.lon],
                    address: appointment.location.dropoffLocation.address  
                }
            }
        })

        await appointmentDataModel.save()

        appointment.appointmentNumber = appointmentDataModel._id

        return appointment
    }

    async overlapExists(date: Date, days: number, listingPlate: string): Promise<boolean> {
        let myEndDate = this.calcEndDate(date, days)

        const listing = await CarListingModel.findOne({licensePlate: listingPlate}).lean().exec()

        const appointments = await AppointmentModel.aggregate([
            { $project: {
                _id: 0,
                status: 1,
                carListing: 1,
                startDate: "$dateInformation.appointmentDate",
                endDate: { $add:["$dateInformation.appointmentDate", {$multiply:[`$dateInformation.days`, 24*60*60000]}] }
            }}, 
            {
                $match:  {
                    startDate: {$lt: myEndDate},
                    endDate: {$gt: date},
                    status: AppointmentStatusType.Accepted,
                    carListing: listing!._id
                }
            }
        ]).limit(2).exec()

        return appointments.length > 0;
    }

    async updateAppointment(apppointmentNumber: string, appointment: AppointmentUpdateFields): Promise<IAppointment | null> {
        // Access the old appointment
        const oldAppointment = await AppointmentModel.findOne({_id:apppointmentNumber}).lean().exec()

        if (!oldAppointment) 
            return null
        
        if (appointment.status){
            oldAppointment.status = appointment.status
        }

        if (appointment.date){
            oldAppointment.dateInformation.appointmentDate = appointment.date
        }

        if (appointment.days){
            oldAppointment.dateInformation.days = appointment.days
        }

        if (appointment.meetupLocation){
            oldAppointment.location.meetupLocation.coordinates = [appointment.meetupLocation.lon, appointment.meetupLocation.lat]
            oldAppointment.location.meetupLocation.address = appointment.meetupLocation.address
        }

        if (appointment.dropoffLocation){
            oldAppointment.location.dropoffLocation.coordinates = [appointment.dropoffLocation.lon, appointment.dropoffLocation.lat]
            oldAppointment.location.dropoffLocation.address = appointment.dropoffLocation.address
        }

        const newAppointment = await AppointmentModel.findOneAndUpdate({_id:apppointmentNumber}, oldAppointment, {new: true}).exec()
        if (newAppointment == null) {
            return null
        }
        await newAppointment.populate("rentee").populate("carListing").execPopulate()
        try{
            const builtAppointment = makeAppointment({
                appointmentNumber: newAppointment._id,
                rentee: makeClient(newAppointment.rentee as IClientModel),
                status: newAppointment.status,
                carListing: (await carListingRepo.findByLicensePlate((newAppointment.carListing as ICarListingModel).licensePlate))!,
                dateInformation: {
                    appointmentDate: newAppointment.dateInformation.appointmentDate,
                    days: newAppointment.dateInformation.days
                },
                location: {
                    meetupLocation: {lat: newAppointment.location.meetupLocation.coordinates[1],
                                    lon: newAppointment.location.meetupLocation.coordinates[0], 
                                    address: newAppointment.location.meetupLocation.address},
                    dropoffLocation: {lat: newAppointment.location.dropoffLocation.coordinates[1],
                        lon: newAppointment.location.dropoffLocation.coordinates[0], 
                        address: newAppointment.location.dropoffLocation.address}
                },
                postAcceptInformation: {
                    dateAccepted: newAppointment.postAcceptInformation?.dateAccepted, 
                    transactions: []
                } 
            })
        }
        catch(err) {
            return null
        }
        return null
    }

}